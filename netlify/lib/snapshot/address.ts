/*
 * Station addresses, from 3,286 live ones (2026-10-21):
 *
 *   "307-313 Ocean Beach Road, UMINA BEACH NSW 2257"   the usual shape
 *   "94 Sturt Hwy BALRANALD NSW 2715"                   no comma before suburb (25)
 *   "Wagga Wagga NSW 2650"                              suburb only
 *   "456, Metford Road, Metford NEW SOUTH WALES 2323"   state spelled out
 *   "52 Hill Street, Uralla, NSW  2358, AU"             trailing country
 *   "20 MORT ST, BRADDON ACT 2612"                      ACT (69 stations)
 *
 * Every one ends in a state and a four-digit postcode, so those are reliable.
 * The suburb is whatever follows the last comma; for the 25 without one, it
 * is recovered by matching the end of the address against suburbs seen in
 * other addresses. Postcodes in the data are sometimes plainly wrong ("Cowra
 * NSW 2646" is Corowa's), so place lookup never trusts a postcode alone -
 * see places.ts in the API function.
 */

const TAIL = /^(.*?)[,\s]+(NSW|ACT|NEW SOUTH WALES)\s+(\d{4})(?:\s*,\s*AU)?\s*$/i;

export interface AddressParts {
  /** Everything before the state, e.g. "307-313 Ocean Beach Road, UMINA BEACH". */
  body: string;
  state: 'NSW' | 'ACT' | null;
  postcode: string | null;
  /** Display form, e.g. "Umina Beach"; null when it cannot be told apart. */
  suburb: string | null;
}

/**
 * The key two place names are compared by: case, accents, full stops,
 * apostrophes and hyphens ignored, and "Mt" read as "Mount" (the data only
 * says "Mount Druitt"; people type "Mt Druitt").
 */
export function placeKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'‘’]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^mt /, 'mount ');
}

/** "UMINA BEACH" -> "Umina Beach"; mixed-case input is left as written. */
export function displayName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => {
    return sep + ch.toUpperCase();
  });
}

function splitTail(address: string): Omit<AddressParts, 'suburb'> & { afterComma: string | null } {
  const clean = address.replace(/\s+/g, ' ').trim();
  const match = TAIL.exec(clean);
  if (!match) return { body: clean, state: null, postcode: null, afterComma: null };
  const [, body = '', state = '', postcode = ''] = match;
  const comma = body.lastIndexOf(',');
  return {
    body,
    state: state.toUpperCase() === 'ACT' ? 'ACT' : 'NSW',
    postcode,
    afterComma: comma >= 0 ? body.slice(comma + 1).trim() || null : null,
  };
}

/**
 * Parses every address in two passes: first the ones with a comma, which
 * name their suburb unambiguously; then the rest, whose suburb is taken to be
 * the longest known suburb the address ends with.
 */
export function parseAddresses(addresses: readonly string[]): AddressParts[] {
  const parts = addresses.map(splitTail);

  const known = new Map<string, string>();
  for (const part of parts) {
    if (part.afterComma) known.set(placeKey(part.afterComma), displayName(part.afterComma));
  }

  return parts.map(({ afterComma, ...rest }) => {
    if (afterComma) return { ...rest, suburb: displayName(afterComma) };
    const words = rest.body.split(' ');
    // Longest suffix first, so "East Wagga Wagga" beats "Wagga Wagga".
    for (let start = 0; start < words.length; start++) {
      const candidate = words.slice(start).join(' ');
      const display = known.get(placeKey(candidate));
      if (display) return { ...rest, suburb: display };
    }
    return { ...rest, suburb: null };
  });
}
