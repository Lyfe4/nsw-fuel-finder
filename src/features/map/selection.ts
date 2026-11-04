import type { StationPrice } from '../../../shared/api';
import type { ResultsLayout } from '../search/searchState';

/**
 * Keeping the list and the map in step. Each user action is a pure function
 * from "what was picked, on what screen" to the URL change it makes and where
 * keyboard focus goes next, so the rules can be tested without a map.
 *
 * The rule behind every `focus`: focus never lands on <body>. If the control
 * that was used stays on screen, focus stays on it. If it disappears (a
 * phone switching between list and map, or a card closing), focus moves to
 * the control that now stands for the same station.
 */

/** Where a station's card is: under its row in the list, or under the map (phones, Map view). */
export type CardPlace = 'list' | 'map';

export type FocusTarget =
  | { kind: 'stay' }
  /** A station's row in the list: the one button that selects it. */
  | { kind: 'list-button'; station: string }
  /** The "Map" button of the list/map switch (phones only). */
  | { kind: 'view-switch' }
  /** The map, but only if focus was lost with the card; otherwise it stays. */
  | { kind: 'map' }
  /** The card under the map (phones): its heading, the card scrolled into view. */
  | { kind: 'card' };

export interface SelectionChange {
  station: string | null;
  /** Only when the view changes. */
  view?: ResultsLayout;
  focus: FocusTarget;
}

/**
 * A station's row pressed in the list. The row is a disclosure: it opens
 * the station's card under it (and selects it on the map), or closes it if
 * it was open. The row stays where it was, so focus stays on it.
 */
export function pickInList(station: string, selected: string | null): SelectionChange {
  return { station: station === selected ? null : station, focus: { kind: 'stay' } };
}

/**
 * A station clicked or tapped on the map: its dot or its price. Pointer only
 * (markers are not in the Tab order).
 *
 * On a wide screen focus is left alone: the list beside the map scrolls to
 * the station instead, which does not take focus from wherever it was.
 *
 * On a phone the card opens under the map, often below the bottom of the
 * screen, where nothing seemed to happen (round 17). So it is brought into
 * view, and focus goes to its heading: a screen reader says which station
 * was picked, and Tab carries on into its actions. A heading focused after a
 * tap is not marked (:focus-visible), so a tap shows no focus ring.
 */
export function pickOnMap(station: string, place: CardPlace): SelectionChange {
  return { station, focus: place === 'map' ? { kind: 'card' } : { kind: 'stay' } };
}

/**
 * The card's Close, or Escape inside it. The card goes away, so focus moves
 * to what led to it: the station's row, or on a phone's map the Map switch.
 */
export function closeSelection(station: string, place: CardPlace): SelectionChange {
  return {
    station: null,
    focus: place === 'list' ? { kind: 'list-button', station } : { kind: 'view-switch' },
  };
}

/**
 * A tap on the map away from every station, or Escape on the map. The map
 * stays, so focus stays; but if it was in the card, which goes away, it goes
 * to the map that was tapped.
 */
export function clearOnMap(): SelectionChange {
  return { station: null, focus: { kind: 'map' } };
}

/** The selected station, if the URL names one that is in these results. */
export function findSelected(
  stations: readonly StationPrice[],
  code: string | null,
): StationPrice | null {
  if (code === null) return null;
  return stations.find((station) => station.stationCode === code) ?? null;
}
