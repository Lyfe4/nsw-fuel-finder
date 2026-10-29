import { formatAsOf } from './format';
import { qldDataNotice, stationSource, type PricesResponse, type SourceId } from '../../shared/api';

/*
 * Where prices come from (round 15). NSW and the ACT from NSW FuelCheck,
 * Queensland from Fuel Prices Qld once it is public. The licence asks for
 * the two to be told apart (clause 4.4), so every place that names a source
 * names the right one.
 */

export const SOURCE_NAMES: Record<SourceId, string> = {
  nsw: 'FuelCheck',
  qld: 'Fuel Prices Qld',
};

/** Each source's prices are told in its own state's time. */
const TIME_ZONES: Record<SourceId, string> = {
  nsw: 'Australia/Sydney',
  qld: 'Australia/Brisbane',
};

const STATE_SHORT: Record<SourceId, string> = { nsw: 'NSW', qld: 'Qld' };

export { stationSource };

/**
 * "Unleaded 91 prices as of 2:30 pm, from FuelCheck." With both states in
 * one answer (a border search), each with its own time and clock:
 * "Unleaded 91 prices as of 2:30 pm (NSW) and 1:30 pm (Qld), from FuelCheck
 * and Fuel Prices Qld." Answers from before round 15 have no `sources`: NSW.
 */
export function asOfSentence(data: PricesResponse, fuelName: string, now: Date): string {
  const sources = data.sources?.length
    ? data.sources
    : [{ id: 'nsw' as const, fetchedAt: data.fetchedAt, stale: data.stale }];
  const times = sources.map((s) => formatAsOf(s.fetchedAt, now, TIME_ZONES[s.id]));
  const names = sources.map((s) => SOURCE_NAMES[s.id]).join(' and ');
  const [only] = times;
  if (sources.length === 1 && only) return `${fuelName} prices as of ${only}, from ${names}.`;
  const when = sources.map((s, i) => `${times[i] ?? ''} (${STATE_SHORT[s.id]})`).join(' and ');
  return `${fuelName} prices as of ${when}, from ${names}.`;
}

const brisbaneYear = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONES.qld,
  year: 'numeric',
});

/** The year in Queensland's licence notice: the year of the data shown. */
export function qldNoticeYear(data: PricesResponse): number {
  const qld = data.sources?.find((s) => s.id === 'qld');
  return Number(brisbaneYear.format(new Date(qld?.fetchedAt ?? data.fetchedAt)));
}

export function hasQldStation(stations: readonly { stationCode: string }[]): boolean {
  return stations.some((s) => stationSource(s.stationCode) === 'qld');
}

export { qldDataNotice };
