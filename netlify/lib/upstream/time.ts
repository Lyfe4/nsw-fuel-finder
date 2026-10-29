/**
 * Date handling at the API.NSW boundary. Nothing here reads the process's own
 * timezone: Netlify runs in UTC, a laptop does not, and the result must not
 * depend on which one ran it.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The `requesttimestamp` and `if-modified-since` headers: UTC,
 * "dd/MM/yyyy hh:mm:ss AM/PM", as the spec documents.
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

// "18/10/2026 01:30:32" (statewide /prices) or "2019-09-29 22:48:51" (the
// spec's v2 nearby example; kept in case /prices ever switches).
const DMY = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Converts an upstream `lastupdated` to ISO 8601 UTC, or null if it is not a
 * real date in either known format.
 *
 * VERIFIED UTC against live data on 2026-10-21: fetched at 03:21 UTC (14:21
 * in Sydney), the newest timestamp was 03:17:28 and the day's 415 updates
 * fell between 00:00 and 03:17 - Sydney's late morning to early afternoon.
 * Read as Sydney time they would have been 11 hours in the future.
 */
export function parseUpstreamTimestamp(value: string): string | null {
  const trimmed = value.trim();
  const dmy = DMY.exec(trimmed);
  const ymd = YMD.exec(trimmed);
  let fields: number[];
  if (dmy) {
    const [, d, m, y, h, mi, s] = dmy.map(Number);
    fields = [y ?? 0, m ?? 0, d ?? 0, h ?? 0, mi ?? 0, s ?? 0];
  } else if (ymd) {
    fields = ymd.slice(1).map(Number);
  } else {
    return null;
  }

  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = fields;
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls 31/02 over into March; a round trip catches that.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day ||
    instant.getUTCHours() !== hour ||
    instant.getUTCMinutes() !== minute ||
    instant.getUTCSeconds() !== second
  ) {
    return null;
  }
  return instant.toISOString().replace('.000Z', 'Z');
}

/** The calendar date in a time zone at an instant, as YYYY-MM-DD. */
function dayIn(timeZone: string): (instant: Date) => string {
  // en-CA formats as YYYY-MM-DD.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (instant) => format.format(instant);
}

/**
 * The calendar date in Sydney at an instant, as YYYY-MM-DD. NSW history is
 * kept per Sydney day because that is the "day" a NSW driver means.
 */
export const sydneyDay = dayIn('Australia/Sydney');

/**
 * The same in Brisbane, for Queensland's data: UTC+10 all year, so from
 * October to April its day starts an hour after Sydney's.
 */
export const brisbaneDay = dayIn('Australia/Brisbane');
