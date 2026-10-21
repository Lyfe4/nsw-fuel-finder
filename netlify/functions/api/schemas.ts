import { z } from 'zod';

/*
 * Zod schemas for what API.NSW sends back, from the v2 Swagger spec
 * (https://apinsw.onegov.nsw.gov.au/api/swagger/spec/22). Each one is as loose
 * as the spec's own inconsistencies require and no looser:
 *
 * - Station codes are integers in the nearby schema and strings everywhere
 *   else, so both are accepted and turned into a string.
 * - `state` is v2-only and missing from the location schema, so optional.
 * - Unknown keys are stripped, not rejected: a new upstream field must not
 *   take the site down.
 *
 * Plain `zod` import: the Patchbay `jitless` wrapper exists for the browser's
 * CSP, which does not apply on the server.
 */

const stationCode = z.union([z.string(), z.number()]).transform(String);

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // A string of seconds in every sample ("43199", about 12 hours).
  expires_in: z.coerce.number().positive(),
});

export const upstreamStationSchema = z.object({
  code: stationCode,
  name: z.string(),
  brand: z.string(),
  address: z.string(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    distance: z.number().optional(),
  }),
  state: z.string().optional(),
});

export const upstreamPriceSchema = z.object({
  stationcode: stationCode,
  fueltype: z.string(),
  price: z.number(),
  lastupdated: z.string(),
  state: z.string().optional(),
});

/** /prices/nearby and /prices/location share this shape. */
export const pricesResponseSchema = z.object({
  stations: z.array(upstreamStationSchema),
  prices: z.array(upstreamPriceSchema),
});

/** /lovs. Only the lists we serve are parsed; the 2 MB station list is not. */
export const referenceResponseSchema = z.object({
  brands: z.object({
    items: z.array(z.object({ name: z.string(), state: z.string().optional() })),
  }),
  fueltypes: z.object({
    items: z.array(z.object({ code: z.string(), name: z.string(), state: z.string().optional() })),
  }),
});

export const upstreamErrorSchema = z.object({
  errorDetails: z.object({ code: z.string(), message: z.string() }),
});

export type UpstreamPricesResponse = z.infer<typeof pricesResponseSchema>;
export type UpstreamReferenceResponse = z.infer<typeof referenceResponseSchema>;
