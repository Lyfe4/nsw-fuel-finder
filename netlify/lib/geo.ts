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

export function centroid(points: readonly LatLng[]): LatLng {
  let latitude = 0;
  let longitude = 0;
  for (const point of points) {
    latitude += point.latitude;
    longitude += point.longitude;
  }
  return { latitude: latitude / points.length, longitude: longitude / points.length };
}

/**
 * Splits points into groups where every point is within `linkKm` of at least
 * one other point in its group (single-linkage clustering). Used to tell two
 * places that share a name - Kingswood near Penrith and Kingswood near
 * Tamworth - apart. Quadratic, which is fine: groups are a few dozen points.
 */
export function cluster<T extends LatLng>(points: readonly T[], linkKm: number): T[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };

  points.forEach((a, i) => {
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j];
      if (b && haversineKm(a, b) <= linkKm) parent[find(j)] = find(i);
    }
  });

  const groups = new Map<number, T[]>();
  points.forEach((point, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(point);
    else groups.set(root, [point]);
  });
  return [...groups.values()];
}
