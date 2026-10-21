/**
 * Fuel type codes the API accepts, used to reject anything else before it
 * costs an upstream call.
 *
 * A static list rather than one read from /lovs at request time: that
 * response is over 2 MB (it carries every station), costs a call from a
 * 2,500-a-month quota, and would be fetched again on every cold start. The
 * codes have been stable since FuelCheck launched. To verify against the live
 * /api/reference once credentials exist - see docs/api-notes.md.
 */
export const FUEL_TYPE_CODES = [
  'E10',
  'U91',
  'P95',
  'P98',
  'DL',
  'PDL',
  'B20',
  'E85',
  'LPG',
  'EV',
] as const;

export type FuelTypeCode = (typeof FUEL_TYPE_CODES)[number];

const codes: ReadonlySet<string> = new Set(FUEL_TYPE_CODES);

export function isFuelTypeCode(value: string): value is FuelTypeCode {
  return codes.has(value);
}
