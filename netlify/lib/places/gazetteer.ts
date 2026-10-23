import data from './gazetteer.json';
import { placeKey } from '../snapshot/address';

/**
 * Every NSW and ACT suburb and locality, and every postcode, from the ABS
 * (ASGS Edition 3, 2021, CC BY 4.0; see scripts/build-gazetteer.js).
 *
 * This is what lets a search find places with no fuel station - Bondi Beach,
 * and most residential suburbs - which station addresses alone could not.
 */

export interface Suburb {
  name: string;
  /** ABS disambiguator for a repeated name, e.g. "Penrith" for one Kingswood. */
  qualifier: string | null;
  state: 'NSW' | 'ACT';
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
    state: state === 'ACT' ? 'ACT' : 'NSW',
    postcode,
    latitude,
    longitude,
    label,
  };
}

export const SUBURBS: readonly Suburb[] = (data.suburbs as SuburbRow[]).map(toSuburb);

export const POSTCODES: ReadonlyMap<string, PostcodeArea> = new Map(
  (data.postcodes as PostcodeRow[]).map(([postcode, latitude, longitude]) => [
    postcode,
    { postcode, latitude, longitude },
  ]),
);

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
export function suburbByLabel(label: string): Suburb | undefined {
  return byLabel.get(placeKey(label));
}

/** Every suburb with this name (Kingswood: three of them). */
export function suburbsNamed(name: string): readonly Suburb[] {
  return byName.get(placeKey(name)) ?? [];
}

/** Suburbs whose name starts with `prefix`, for "Wagga" -> Wagga Wagga. */
export function suburbsStartingWith(prefix: string): Suburb[] {
  const key = placeKey(prefix);
  return keyed.filter(({ name }) => name.startsWith(key)).map(({ suburb }) => suburb);
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
export function suggestPlaces(input: string): string[] {
  const query = placeKey(input);
  if (!query) return [];

  if (/^\d{1,4}$/.test(query)) {
    return SUBURBS.filter((suburb) => suburb.postcode?.startsWith(query))
      .sort(
        (a, b) =>
          (a.postcode ?? '').localeCompare(b.postcode ?? '') || a.name.localeCompare(b.name),
      )
      .slice(0, SUGGESTION_LIMIT)
      .map((suburb) => suburb.label);
  }

  const scored: { suburb: Suburb; score: number }[] = [];
  for (const { suburb, name, qualifier } of keyed) {
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
