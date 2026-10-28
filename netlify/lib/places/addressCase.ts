import { suburbsNamed } from './gazetteer';

/*
 * FuelCheck's addresses come in three cases: all capitals ("57 CENTRAL
 * COAST HWY, WEST GOSFORD NSW 2250"), written with care ("55 Central Coast
 * Highway, Gosford West NSW 2250"), and a mix: a careful street with the
 * suburb in capitals ("459 Pacific Hwy, WYOMING NSW 2250").
 *
 * This mends the mix. A suburb in capitals that the ABS gazetteer knows is
 * given the gazetteer's own spelling ("Wyoming", "McGraths Hill"); one it
 * does not know is left as it is, and nothing else in the address changes:
 * the street, its abbreviations, the state and the postcode stay as FuelCheck
 * wrote them. All-capital addresses are left whole for the browser, which
 * sets them in title case (src/lib/format.ts, formatAddress), so the two
 * never meet on one address.
 */

/** The state, the postcode and what follows (", AU"), and what comes before. */
const TAIL = /^(.*?)([,\s]+)(NSW|ACT|NEW SOUTH WALES)(\s+\d{4}.*)$/i;

const memo = new Map<string, string>();

export function mendAddressCase(address: string): string {
  const known = memo.get(address);
  if (known !== undefined) return known;
  const mended = mend(address);
  // About 3,300 stations: bounded by the data, so a plain map is enough.
  memo.set(address, mended);
  return mended;
}

function mend(address: string): string {
  // All capitals (or no letters at all): the browser's to tidy.
  if (!/[a-z]/.test(address)) return address;
  const match = TAIL.exec(address);
  if (!match) return address;
  const [, body = '', separator = '', state = '', rest = ''] = match;

  const comma = body.lastIndexOf(',');
  if (comma >= 0) {
    const suburb = body.slice(comma + 1).trim();
    const fixed = gazetteerName(suburb);
    if (!fixed) return address;
    const space = /^\s*/.exec(body.slice(comma + 1))?.[0] ?? '';
    const lead = `${body.slice(0, comma + 1)}${space}`;
    return `${lead}${fixed}${separator}${state}${rest}`;
  }

  // No comma ("94 Sturt Hwy BALRANALD NSW 2715"): the longest run of
  // capital words at the end that the gazetteer knows.
  const words = body.split(' ');
  for (let start = 0; start < words.length; start++) {
    const fixed = gazetteerName(words.slice(start).join(' '));
    if (fixed) return `${[...words.slice(0, start), fixed].join(' ')}${separator}${state}${rest}`;
  }
  return address;
}

/** The gazetteer's spelling of a suburb written in capitals, if it knows it. */
function gazetteerName(written: string): string | null {
  // Capitals, allowing for the "Mc" some write in front ("McGRATHS HILL").
  if (!/[A-Z]/.test(written) || written.replace(/Mc/g, 'MC') !== written.toUpperCase()) return null;
  return suburbsNamed(written)[0]?.name ?? null;
}
