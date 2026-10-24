/** Types for fuelcheck-history.mjs, so its TypeScript test is checked. */

export const STATION_HISTORY_VERSION: 2;

export interface FuelCheckEvent {
  name: string;
  address: string;
  postcode: string;
  fuel: string;
  /** Sydney wall-clock "YYYY-MM-DDTHH:MM:SS". */
  time: string;
  price: number;
}

export interface MatchableStation {
  code: string;
  name: string;
  address: string;
  postcode: string | null;
}

export type DailyRow = [day: string, low: number, high: number, last: number];

export function readXlsxRows(buffer: Uint8Array): string[][];
export function readCsvRows(text: string): string[][];
export function localTime(value: string | number): string | null;
export function parseEvents(rows: string[][]): { events: FuelCheckEvent[]; rejected: number };
export function matchStations(
  events: FuelCheckEvent[],
  stations: MatchableStation[],
): {
  codeFor: (event: FuelCheckEvent) => string | null;
  report: {
    byAddress: number;
    byNameAndPostcode: number;
    unmatched: { name: string; address: string }[];
  };
};
export function nextDay(day: string): string;
export function dailyRows(events: FuelCheckEvent[], from: string, through: string): DailyRow[];
export function buildBackfill(input: {
  events: FuelCheckEvent[];
  stations: MatchableStation[];
  from: string;
  through: string;
  fuels: string[];
}): {
  files: Map<
    string,
    {
      version: 2;
      code: string;
      source: 'fuelcheck-monthly';
      from: string;
      through: string;
      fuels: Record<string, DailyRow[]>;
    }
  >;
  report: {
    byAddress: number;
    byNameAndPostcode: number;
    unmatched: { name: string; address: string }[];
    events: number;
    matchedEvents: number;
  };
};
