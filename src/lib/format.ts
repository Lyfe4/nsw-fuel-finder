/**
 * Display formatting. Everything a NSW driver reads is in Sydney time and
 * Australian English, whatever the device is set to - a phone on holiday in
 * another timezone should still say prices are "as of 2:30 pm" Sydney time.
 */

const TIME_ZONE = 'Australia/Sydney';

const clock = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

const dayAndClock = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const relative = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });

/** 227.5 -> "227.5" (one decimal, as pumps show it). */
export function formatPrice(cents: number): string {
  return cents.toFixed(1);
}

/** Kept in capitals in an address: the states and territories. */
const STATES = new Set(['NSW', 'ACT', 'QLD', 'VIC', 'SA', 'WA', 'TAS', 'NT']);

/**
 * "57 CENTRAL COAST HWY, WEST GOSFORD NSW 2250" -> "57 Central Coast Hwy,
 * West Gosford NSW 2250". FuelCheck has some addresses in capitals and some
 * not; capitals are hard to read and shout beside the others. Only an
 * address with no lower-case letter at all is changed, so one a retailer
 * wrote with care ("McGraths Hill") is left alone. Numbers ("6-8", "2250",
 * "1A") and state codes stay as they are.
 */
export function formatAddress(address: string): string {
  if (/[a-z]/.test(address)) return address;
  return address.replace(/[A-Z][A-Z'-]*/g, (word) =>
    STATES.has(word)
      ? word
      : word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, before: string, letter: string) => {
          return `${before}${letter.toUpperCase()}`;
        }),
  );
}

/** 0.42 -> "420 m", 3.91 -> "3.9 km", 12.3 -> "12 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${String(Math.round((km * 1000) / 10) * 10)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${String(Math.round(km))} km`;
}

/** "2:30 pm" today, "Thu, 22 Oct, 2:30 pm" on any other day. */
export function formatAsOf(iso: string, now: Date): string {
  const date = new Date(iso);
  return dayKey.format(date) === dayKey.format(now) ? clock.format(date) : dayAndClock.format(date);
}

/** "5 minutes ago", "3 hours ago", "yesterday", "12 days ago", "8 years ago". */
export function formatAge(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 60) return relative.format(Math.round(seconds / 86_400), 'day');
  if (abs < 86_400 * 365) return relative.format(Math.round(seconds / (86_400 * 30)), 'month');
  return relative.format(Math.round(seconds / (86_400 * 365)), 'year');
}
