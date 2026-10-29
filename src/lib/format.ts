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
  return address.replace(/[A-Z][A-Z'-]*/g, (word) => (STATES.has(word) ? word : titleWord(word)));
}

/**
 * One word in capitals in title case: "GOSFORD" -> "Gosford", "7-ELEVEN"'s
 * "ELEVEN" after its hyphen, "U-GO" -> "U-Go", "O'CONNELL" -> "O'Connell".
 * A possessive stays small: "JOHN'S" -> "John's", not "John'S".
 */
function titleWord(word: string): string {
  return word
    .toLowerCase()
    .replace(
      /(^|-)([a-z])/g,
      (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    )
    .replace(/^([a-z])'([a-z]{2,})/i, (_, first: string, rest: string) => {
      return `${first.toUpperCase()}'${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
    });
}

/**
 * Kept in capitals in a station's name: brands and initials FuelCheck's
 * retailers write that way (found in the snapshot, October 2026), the
 * states, and motorway numbers' letters.
 */
const NAME_CAPITALS = new Set([
  ...STATES,
  'BP',
  'EG',
  'OTR',
  'OPT',
  'APW',
  'APCO',
  'AUS',
  'CBD',
  'EBM',
  'IGA',
  'IOR',
  'LPG',
  'LPO',
  'METCO',
  'NRMA',
  'RSL',
  'TASCO',
  'TEMCO',
]);

/** Short forms with no vowel that are words, not initials: "MT DRUITT" -> "Mt Druitt". */
const ABBREVIATIONS = new Set(['MT', 'ST', 'RD', 'DR', 'CNR', 'CT', 'PL', 'HWY']);

/**
 * "MOBIL HASTINGS RIVER" -> "Mobil Hastings River", as formatAddress does
 * for addresses, and only for a name with no lower-case letter at all, so
 * one a retailer wrote with care ("OTR Kings Park") is left alone.
 *
 * What stays in capitals, so a brand is never respelt: the words in
 * NAME_CAPITALS ("BP Camden", "Lowes North Star OPT"); any word the
 * station's brand writes in capitals beside lower case ("TEMCO Petroleum",
 * "EG Ampol"); and initials, a word with no vowel ("SG Chambers", "PK's"),
 * except the usual short forms ("Mt", "St"). An all-capitals brand ("MATEX
 * FUEL") is no guide: it shouts like the name does.
 */
export function formatStationName(name: string, brand = ''): string {
  if (/[a-z]/.test(name)) return name;
  const brandCapitals = new Set(/[a-z]/.test(brand) ? brand.match(/[A-Z][A-Z0-9-]+/g) : []);
  return name.replace(/[A-Z][A-Z'-]*/g, (word) => {
    const possessive = word.endsWith("'S");
    const base = possessive ? word.slice(0, -2) : word;
    const initials = base.length > 1 && !/[AEIOUY]/.test(base) && !ABBREVIATIONS.has(base);
    const kept = NAME_CAPITALS.has(base) || brandCapitals.has(base) || initials;
    return `${kept ? base : titleWord(base)}${possessive ? "'s" : ''}`;
  });
}

/** 0.42 -> "420 m", 3.91 -> "3.9 km", 12.3 -> "12 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${String(Math.round((km * 1000) / 10) * 10)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${String(Math.round(km))} km`;
}

/** Queensland's prices are told in Queensland's time (round 15): no daylight saving. */
const zoned = new Map<
  string,
  { clock: Intl.DateTimeFormat; dayAndClock: Intl.DateTimeFormat; dayKey: Intl.DateTimeFormat }
>();
function formattersFor(timeZone: string) {
  if (timeZone === TIME_ZONE) return { clock, dayAndClock, dayKey };
  let found = zoned.get(timeZone);
  if (!found) {
    found = {
      clock: new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }),
      dayAndClock: new Intl.DateTimeFormat('en-AU', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
      dayKey: new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    };
    zoned.set(timeZone, found);
  }
  return found;
}

/**
 * "2:30 pm" today, "Thu, 22 Oct, 2:30 pm" on any other day. In Sydney time
 * unless told otherwise; Queensland's in Brisbane's.
 */
export function formatAsOf(iso: string, now: Date, timeZone = TIME_ZONE): string {
  const f = formattersFor(timeZone);
  const date = new Date(iso);
  return f.dayKey.format(date) === f.dayKey.format(now)
    ? f.clock.format(date)
    : f.dayAndClock.format(date);
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
