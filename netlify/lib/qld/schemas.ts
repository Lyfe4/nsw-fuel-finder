import { z } from 'zod';

/*
 * Zod schemas for what the Queensland Fuel Prices API sends, checked against
 * live responses on 2026-10-29 (docs/qld-plan.md, "The API"):
 *
 * - The manual says fields may be added or reordered at any time. Unknown
 *   keys are stripped, not rejected.
 * - Each list is checked as a list here and row by row by the caller, so one
 *   malformed site or price is dropped and counted, not the whole run.
 */

/** GET /Subscriber/GetFullSiteDetails. Only the fields we use. */
export const qldSiteSchema = z.object({
  S: z.number().int(),
  /** The street only: no suburb, state or postcode. Sometimes empty. */
  A: z.string().nullable(),
  N: z.string(),
  B: z.number().int(),
  P: z.union([z.string(), z.number()]).transform(String),
  /** The suburb: a level-1 region ID. */
  G1: z.number().int(),
  Lat: z.number(),
  Lng: z.number(),
});

export const qldSitesResponseSchema = z.object({ S: z.array(z.unknown()) });

/** GET /Subscriber/GetCountryBrands */
export const qldBrandsResponseSchema = z.object({
  Brands: z.array(z.object({ BrandId: z.number().int(), Name: z.string() })),
});

/** GET /Subscriber/GetCountryGeographicRegions: suburbs (1), cities (2), states (3). */
export const qldRegionsResponseSchema = z.object({
  GeographicRegions: z.array(
    z.object({ GeoRegionLevel: z.number().int(), GeoRegionId: z.number().int(), Name: z.string() }),
  ),
});

/** GET /Price/GetSitesPrices */
export const qldPriceSchema = z.object({
  SiteId: z.number().int(),
  FuelId: z.number().int(),
  /** UTC, but with no offset: "2026-09-19T21:09:50.913". */
  TransactionDateUtc: z.string(),
  /** Tenths of a cent; 9999 means unavailable at the site. */
  Price: z.number(),
});

export const qldPricesResponseSchema = z.object({ SitePrices: z.array(z.unknown()) });

export type QldSite = z.infer<typeof qldSiteSchema>;
export type QldPrice = z.infer<typeof qldPriceSchema>;
export type QldBrands = z.infer<typeof qldBrandsResponseSchema>;
export type QldRegions = z.infer<typeof qldRegionsResponseSchema>;
