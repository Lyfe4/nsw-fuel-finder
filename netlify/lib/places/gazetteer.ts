import data from './gazetteer.json';
import { placeKey } from '../snapshot/address';

/**
 * Every NSW, ACT and Queensland suburb and locality, and every postcode, from the ABS
 * (ASGS Edition 3, 2021, CC BY 4.0; see scripts/build-gazetteer.js).
 *
 * This is what lets a search find places with no fuel station - Bondi Beach,
 * and most residential suburbs - which station addresses alone could not.
 *
 * Queensland's are included (round 15) but ONLY USED WHEN IT IS PUBLIC: each
 * lookup takes `withQld`, false by default, so while QLD_PUBLIC is off the
 * API offers and finds exactly the NSW and ACT places it always has.
 */

export interface Suburb {
  name: string;
  /** ABS disambiguator for a repeated name, e.g. "Penrith" for one Kingswood. */
  qualifier: string | null;
  state: 'NSW' | 'ACT' | 'QLD';
  postcode: string | null;
  latitude: number;
  longitude: number;
  /** Unique: "Kingswood (Penrith) NSW 2747", "Bondi Beach NSW 2026". */
  label: string;
}

export interface PostcodeArea {
  postcode: string;
  latitude: number;
  longitude: number;
}

type SuburbRow = [string, string, string | null, string, string | null, number, number];
type PostcodeRow = [string, number, number];

function toSuburb([, name, qualifier, state, postcode, latitude, longitude]: SuburbRow): Suburb {
  const label = `${name}${qualifier ? ` (${qualifier})` : ''} ${state}${postcode ? ` ${postcode}` : ''}`;
  return {
    name,
    qualifier,
    state: state === 'ACT' || state === 'QLD' ? state : 'NSW',
    postcode,
    latitude,
    longitude,
    label,
  };
}

export const SUBURBS: readonly Suburb[] = (data.suburbs as SuburbRow[]).map(toSuburb);

const POSTCODES: ReadonlyMap<string, PostcodeArea> = new Map(
  (data.postcodes as PostcodeRow[]).map(([postcode, latitude, longitude]) => [
    postcode,
    { postcode, latitude, longitude },
  ]),
);

const covered = (suburb: Suburb, withQld: boolean): boolean => withQld || suburb.state !== 'QLD';

/** Queensland's postcodes are 4xxx; NSW's and the ACT's start with 1 or 2. */
export const isQldPostcode = (postcode: string): boolean => postcode.startsWith('4');

/** A postcode's postal area, if the ABS has one and the API covers it. */
export function postcodeArea(postcode: string, withQld = false): PostcodeArea | undefined {
  if (!withQld && isQldPostcode(postcode)) return undefined;
  return POSTCODES.get(postcode);
}

/** Every postal area, whatever the coverage: for tests and checks. */
export function allPostcodeAreas(): readonly PostcodeArea[] {
  return [...POSTCODES.values()];
}

/** Normalised once at load; suggestions run on every keystroke. */
const keyed = SUBURBS.map((suburb) => ({
  suburb,
  name: placeKey(suburb.name),
  qualifier: suburb.qualifier ? placeKey(suburb.qualifier) : null,
}));

const byName = new Map<string, Suburb[]>();
const byLabel = new Map<string, Suburb>();
for (const { suburb, name: key } of keyed) {
  const list = byName.get(key);
  if (list) list.push(suburb);
  else byName.set(key, [suburb]);
  byLabel.set(placeKey(suburb.label), suburb);
}

/** The suburb whose full label this is, if any. Suggestions submit labels. */
export function suburbByLabel(label: string, withQld = false): Suburb | undefined {
  const suburb = byLabel.get(placeKey(label));
  return suburb && covered(suburb, withQld) ? suburb : undefined;
}

/** Every suburb with this name (Kingswood: three of them). */
export function suburbsNamed(name: string, withQld = false): readonly Suburb[] {
  return (byName.get(placeKey(name)) ?? []).filter((suburb) => covered(suburb, withQld));
}

/** Suburbs whose name starts with `prefix`, for "Wagga" -> Wagga Wagga. */
export function suburbsStartingWith(prefix: string, withQld = false): Suburb[] {
  const key = placeKey(prefix);
  return keyed
    .filter(({ suburb, name }) => name.startsWith(key) && covered(suburb, withQld))
    .map(({ suburb }) => suburb);
}

export const SUGGESTION_LIMIT = 8;

/**
 * Suggestions for a partly typed place, best first:
 *
 *  0. the name is exactly what was typed            "kingswood" -> Kingswood (x3)
 *  1. the name starts with it                        "wagga"     -> Wagga Wagga
 *  2. a later word of the name starts with it        "wagga"     -> North Wagga Wagga
 *  3. its qualifier starts with it                 "penrith"   -> Kingswood (Penrith)
 *
 * then shorter names first, then alphabetically. Digits are read as a postcode
 * prefix: "225" offers the suburbs in 2250, 2251, ...
 */
export function suggestPlaces(input: string, withQld = false): string[] {
  const query = placeKey(input);
  if (!query) return [];

  if (/^\d{1,4}$/.test(query)) {
    return SUBURBS.filter(
      (suburb) => covered(suburb, withQld) && suburb.postcode?.startsWith(query),
    )
      .sort(
        (a, b) =>
          (a.postcode ?? '').localeCompare(b.postcode ?? '') || a.name.localeCompare(b.name),
      )
      .slice(0, SUGGESTION_LIMIT)
      .map((suburb) => suburb.label);
  }

  const scored: { suburb: Suburb; score: number }[] = [];
  for (const { suburb, name, qualifier } of keyed) {
    if (!covered(suburb, withQld)) continue;
    let score = -1;
    if (name === query) score = 0;
    else if (name.startsWith(query)) score = 1;
    else if (name.split(' ').some((word, i) => i > 0 && word.startsWith(query))) score = 2;
    else if (qualifier?.startsWith(query)) score = 3;
    if (score >= 0) scored.push({ suburb, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.suburb.name.length - b.suburb.name.length ||
        a.suburb.label.localeCompare(b.suburb.label),
    )
    .slice(0, SUGGESTION_LIMIT)
    .map(({ suburb }) => suburb.label);
}
