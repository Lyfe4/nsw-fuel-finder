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

/** Wide screens show the list and the map side by side; narrow ones, one at a time. */
export type ScreenWidth = 'wide' | 'narrow';

export type FocusTarget =
  | { kind: 'stay' }
  /** The selected station's card, beside the map. */
  | { kind: 'card' }
  /** A station's "Show on map" button in the list. */
  | { kind: 'list-button'; station: string }
  /** The "Map" button of the list/map switch (phones only). */
  | { kind: 'view-switch' };

export interface SelectionChange {
  station: string | null;
  /** Only when the view changes. */
  view?: ResultsLayout;
  focus: FocusTarget;
}

/** "Show on map" in the list. On a phone the list goes away, so focus goes to the card. */
export function showOnMap(station: string, width: ScreenWidth): SelectionChange {
  return width === 'wide'
    ? { station, focus: { kind: 'stay' } }
    : { station, view: 'map', focus: { kind: 'card' } };
}

/**
 * A station clicked or tapped on the map. Pointer only (markers are not in
 * the Tab order), and focus is left alone: the list scrolls to the station
 * instead, which does not take focus from wherever it was.
 */
export function pickOnMap(station: string): SelectionChange {
  return { station, focus: { kind: 'stay' } };
}

/** The card's "Show in list" (phones only): back to the list, on that station. */
export function showInList(station: string): SelectionChange {
  return { station, view: 'list', focus: { kind: 'list-button', station } };
}

/** The card's close button. The card goes away, so focus moves to what led to it. */
export function closeSelection(station: string, width: ScreenWidth): SelectionChange {
  return {
    station: null,
    focus: width === 'wide' ? { kind: 'list-button', station } : { kind: 'view-switch' },
  };
}

/** The selected station, if the URL names one that is in these results. */
export function findSelected(
  stations: readonly StationPrice[],
  code: string | null,
): StationPrice | null {
  if (code === null) return null;
  return stations.find((station) => station.stationCode === code) ?? null;
}
