import { z } from 'zod';

/*
 * Zod schemas for what API.NSW sends, checked against live responses on
 * 2026-10-21 (recorded subset in ../__fixtures__/prices.json):
 *
 * - `stations[].code` is a string and `prices[].stationcode` is a number in
 *   the same response, so both are accepted and turned into a string.
 * - `state` is present on every row of the statewide response; optional here
 *   in case it is not.
 * - Unknown keys are stripped, not rejected: a new upstream field must not
 *   stop the snapshot.
 *
 * Plain `zod` import: Patchbay's `jitless` wrapper exists for a browser CSP,
 * which does not apply on the server.
 */

const stationCode = z.union([z.string(), z.number()]).transform(String);

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // A string of seconds: "43199", about 12 hours, in the live response.
  expires_in: z.coerce.number().positive(),
});

export const upstreamStationSchema = z.object({
  code: stationCode,
  name: z.string(),
  brand: z.string(),
  address: z.string(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  state: z.string().optional(),
});

export const upstreamPriceSchema = z.object({
  stationcode: stationCode,
  fueltype: z.string(),
  price: z.number(),
  lastupdated: z.string(),
  state: z.string().optional(),
});

/** GET /FuelPriceCheck/v2/fuel/prices */
export const statewidePricesSchema = z.object({
  stations: z.array(upstreamStationSchema),
  prices: z.array(upstreamPriceSchema),
});

export const upstreamErrorSchema = z.object({
  errorDetails: z.object({ code: z.string(), message: z.string() }),
});

export type UpstreamStation = z.infer<typeof upstreamStationSchema>;
export type UpstreamPrice = z.infer<typeof upstreamPriceSchema>;
export type StatewidePrices = z.infer<typeof statewidePricesSchema>;
