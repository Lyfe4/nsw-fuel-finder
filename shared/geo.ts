/**
 * Distance maths used by both sides: the API filters and sorts with it, and
 * the browser recomputes exact distances from the precise position it has
 * (the API only ever sees a position rounded to ~1 km).
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in km. Accurate to well under 0.5% at NSW scales,
 * which is far better than the ~1 km rounding applied to search positions.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
