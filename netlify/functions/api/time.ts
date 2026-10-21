/**
 * Date handling at the API.NSW boundary.
 *
 * Netlify runs functions in UTC, and API.NSW speaks in two different local
 * formats, so nothing here relies on the process's own timezone: every
 * conversion names its zone explicitly.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The `requesttimestamp` header: UTC, "dd/MM/yyyy hh:mm:ss AM/PM" as the spec
 * documents. Some clients send ISO 8601 and report it works, but the spec's
 * own error example shows the server parsing these headers, so we send the
 * documented form.
 */
export function formatRequestTimestamp(date: Date): string {
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${String(date.getUTCFullYear())} ` +
    `${pad(hours12)}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${meridiem}`
  );
}

const SYDNEY = 'Australia/Sydney';

const sydneyParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Sydney's offset from UTC, in minutes, at the given instant (600 or 660). */
function sydneyOffsetMinutes(instant: number): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of sydneyParts.formatToParts(instant)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return Math.round((asUtc - instant) / 60_000);
}

// "26/09/2019 02:51:27" (most endpoints) or "2019-09-29 22:48:51" (v2 nearby).
const DMY = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Converts an upstream `lastupdated` to ISO 8601 with the Sydney offset, or
 * returns null if it is in neither known format.
 *
 * ASSUMPTION, unverified until we see live data: the timestamps are Sydney
 * wall-clock time. The spec does not say. If live data shows UTC, this is the
 * one function to change.
 */
export function parseUpstreamTimestamp(value: string): string | null {
  const trimmed = value.trim();
  let fields: number[];
  const dmy = DMY.exec(trimmed);
  const ymd = YMD.exec(trimmed);
  if (dmy) {
    const [, d, m, y, h, mi, s] = dmy.map(Number);
    fields = [y, m, d, h, mi, s].map((n) => n ?? 0);
  } else if (ymd) {
    fields = ymd.slice(1).map(Number);
  } else {
    return null;
  }

  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = fields;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  // Treat the wall-clock time as if it were UTC, then shift by Sydney's offset
  // at that moment. Checking the offset a second time at the corrected instant
  // handles the hour either side of a daylight-saving change.
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = sydneyOffsetMinutes(wallAsUtc - sydneyOffsetMinutes(wallAsUtc) * 60_000);
  const instant = wallAsUtc - offset * 60_000;
  offset = sydneyOffsetMinutes(instant);

  // Formatted from the resolved instant rather than echoing the input, so a
  // time inside the spring-forward gap still comes out as a real instant.
  const local = new Date(instant + offset * 60_000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${String(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
