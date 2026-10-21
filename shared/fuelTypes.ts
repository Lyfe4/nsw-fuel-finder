/**
 * The fuels we offer, with the names FuelCheck uses for them.
 *
 * Verified against live data on 2026-10-21 (see docs/api-notes.md). FuelCheck's
 * reference list has 16 entries; the ones left out are:
 *
 * - combined codes (E10-U91, P95-P98, DL-PDL), which FuelCheck's own app uses
 *   for searching and which never appear on a price row;
 * - LNG, H2 and CNG, which had no prices statewide;
 * - EV, which had 902 rows of which 900 were 0 and the other two were from
 *   2020-21, priced per kWh rather than per litre.
 *
 * Ordered by how many stations sell each, which is a fair proxy for how many
 * people want it. This list is bundled into the app, so choosing a fuel needs
 * no network request.
 */
export const FUEL_TYPES = [
  { code: 'U91', name: 'Unleaded 91' },
  { code: 'E10', name: 'Ethanol 94' },
  { code: 'P98', name: 'Premium 98' },
  { code: 'P95', name: 'Premium 95' },
  { code: 'DL', name: 'Diesel' },
  { code: 'PDL', name: 'Premium Diesel' },
  { code: 'LPG', name: 'LPG' },
  { code: 'E85', name: 'Ethanol 105' },
  { code: 'B20', name: 'Biodiesel 20' },
] as const;

export type FuelTypeCode = (typeof FUEL_TYPES)[number]['code'];

export const FUEL_TYPE_CODES: readonly FuelTypeCode[] = FUEL_TYPES.map((fuel) => fuel.code);

const codes: ReadonlySet<string> = new Set(FUEL_TYPE_CODES);

export function isFuelTypeCode(value: string): value is FuelTypeCode {
  return codes.has(value);
}
