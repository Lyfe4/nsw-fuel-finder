import { haversineKm, type LatLng } from '../../shared/geo';

export { haversineKm, roundTo, type LatLng } from '../../shared/geo';

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
