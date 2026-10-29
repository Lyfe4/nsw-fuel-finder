import type { FuelTypeCode } from '../../../shared/fuelTypes';

/**
 * Queensland's fuel IDs (GetCountryFuelTypes, 29 October 2026) onto ours.
 * Anything else is dropped and counted, never guessed: OPAL (21, two remote
 * sites), ULSD (6), LRP (11), Premium e5 (13), CNG and LNG (22, 23), and the
 * combined search codes 999 and 1000. See docs/qld-plan.md, "Fuel types".
 */
export const QLD_FUELS: Readonly<Record<number, FuelTypeCode>> = {
  2: 'U91',
  12: 'E10',
  5: 'P95',
  8: 'P98',
  3: 'DL',
  14: 'PDL',
  4: 'LPG',
  19: 'E85',
  16: 'B20',
};

/**
 * Queensland's names for chains FuelCheck spells differently, so a brand
 * filter over a border search lists each chain once. Checked against the
 * NSW snapshot's brands on 29 October 2026.
 */
export const QLD_BRAND_ALIASES: Readonly<Record<string, string>> = {
  '7 Eleven': '7-Eleven',
  'IOR Pty Ltd': 'IOR Group',
  Astron: 'ASTRON',
  SOLO: 'Solo',
};

/** Tenths of a cent that mean "not available at this site". */
export const QLD_UNAVAILABLE = 9999;

/**
 * Cents a litre outside which a price is a typo, not a price (as the NSW
 * backfill: scripts/lib/fuelcheck-history.mjs). Seen live: a diesel at 31.9.
 */
export const PLAUSIBLE_CENTS = { min: 50, max: 600 } as const;
