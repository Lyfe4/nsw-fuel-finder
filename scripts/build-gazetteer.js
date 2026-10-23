/**
 * Builds netlify/lib/places/gazetteer.json: every NSW and ACT suburb/locality
 * with a point to search from and its postcode, plus every NSW/ACT postcode.
 *
 *   node scripts/build-gazetteer.js
 *
 * Source: Australian Bureau of Statistics, Australian Statistical Geography
 * Standard (ASGS) Edition 3 - Suburbs and Localities (SAL) 2021 and Postal
 * Areas (POA) 2021, licensed CC BY 4.0, via the ABS ArcGIS service at
 * geo.abs.gov.au. The output is committed, so this only needs re-running when
 * the ABS publishes a new edition (next due with the 2026 Census boundaries).
 *
 * Suburbs come with a centroid computed by the service. They have no postcode
 * field, so each is given the postcode whose (generalised) polygon contains
 * its centroid. A centroid can fall outside an odd-shaped suburb, so a few
 * postcodes may be a neighbour's; the postcode is only used to label and
 * narrow results, never to search.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021';
const OUTPUT = fileURLToPath(new URL('../netlify/lib/places/gazetteer.json', import.meta.url));
const STATES = { 1: 'NSW', 8: 'ACT' };
const PAGE = 2000;

async function query(service, params) {
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(`${BASE}/${service}/FeatureServer/0/query`);
    const search = { ...params, resultOffset: offset, resultRecordCount: PAGE, f: 'json' };
    for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${service}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${service}: ${JSON.stringify(body.error)}`);
    features.push(...body.features);
    if (!body.exceededTransferLimit && body.features.length < PAGE) return features;
  }
}

const round = (n) => Math.round(n * 10_000) / 10_000;

/** Even-odd ray casting over every ring, so holes are handled. */
function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function bbox(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Coastal suburbs can have a centroid just offshore of the generalised
 * postcode outline (Malabar, Narrabeen, Whale Beach). For those, the postcode
 * with a boundary point within 3 km. Rough degrees-to-km is fine at this scale.
 */
function nearest(x, y) {
  const KM_PER_DEG = 111;
  let best = null;
  let bestKm = 3;
  for (const poa of poas) {
    for (const ring of poa.rings) {
      for (const [px, py] of ring) {
        const km = Math.hypot((px - x) * Math.cos((y * Math.PI) / 180), py - y) * KM_PER_DEG;
        if (km < bestKm) {
          bestKm = km;
          best = poa;
        }
      }
    }
  }
  return best;
}

/** "Kingswood (Penrith - NSW)" -> { name: "Kingswood", qualifier: "Penrith" } */
function splitName(raw) {
  const match = /^(.*?)\s*\((.*)\)$/.exec(raw);
  if (!match) return { name: raw, qualifier: null };
  const qualifier = match[2].replace(/\s*-?\s*\b(NSW|ACT)$/, '').trim();
  return { name: match[1], qualifier: qualifier || null };
}

console.warn('Fetching postal areas...');
const poas = (
  await query('POA', {
    where: "poa_code_2021 >= '2000' AND poa_code_2021 <= '2999'",
    outFields: 'poa_code_2021',
    returnGeometry: true,
    returnCentroid: true,
    outSR: 4326,
    // ~100 m generalisation: plenty for "which postcode is this point in",
    // and it keeps the download to a few MB.
    maxAllowableOffset: 0.001,
    geometryPrecision: 5,
  })
)
  // 2899 is Norfolk Island: in the NSW postcode range, but an external
  // territory 1,400 km offshore with no FuelCheck stations.
  .filter((f) => f.geometry?.rings && f.centroid && f.attributes.poa_code_2021 !== '2899')
  .map((f) => ({
    postcode: f.attributes.poa_code_2021,
    rings: f.geometry.rings,
    box: bbox(f.geometry.rings),
    centroid: f.centroid,
  }));

console.warn('Fetching suburbs and localities...');
const sals = (
  await query('SAL', {
    where: "state_code_2021 IN ('1', '8')",
    outFields: 'sal_code_2021,sal_name_2021,state_code_2021',
    returnGeometry: false,
    returnCentroid: true,
    outSR: 4326,
  })
).filter(
  (f) =>
    f.centroid &&
    // Census-only pseudo-areas, not places.
    !/^(No usual address|Migratory - Offshore - Shipping)/.test(f.attributes.sal_name_2021),
);

let unmatched = 0;
const suburbs = sals.map((f) => {
  const { x, y } = f.centroid;
  const poa = poas.find(
    (p) =>
      x >= p.box.minX &&
      x <= p.box.maxX &&
      y >= p.box.minY &&
      y <= p.box.maxY &&
      contains(p.rings, x, y),
  );
  const postcodeArea = poa ?? nearest(x, y);
  if (!postcodeArea) unmatched++;
  const { name, qualifier } = splitName(f.attributes.sal_name_2021);
  return [
    f.attributes.sal_code_2021,
    name,
    qualifier,
    STATES[f.attributes.state_code_2021],
    postcodeArea?.postcode ?? null,
    round(y),
    round(x),
  ];
});

suburbs.sort(
  (a, b) => a[1].localeCompare(b[1], 'en-AU') || String(a[2]).localeCompare(String(b[2])),
);
const postcodes = poas
  .map((p) => [p.postcode, round(p.centroid.y), round(p.centroid.x)])
  .sort((a, b) => a[0].localeCompare(b[0]));

writeFileSync(
  OUTPUT,
  JSON.stringify({
    source:
      'Australian Bureau of Statistics, ASGS Edition 3: Suburbs and Localities 2021 and Postal Areas 2021. CC BY 4.0.',
    generatedAt: new Date().toISOString().slice(0, 10),
    // [salCode, name, qualifier, state, postcode, lat, lng]
    suburbs,
    // [postcode, lat, lng]
    postcodes,
  }) + '\n',
);
console.warn(
  `Wrote ${suburbs.length} suburbs (${unmatched} without a postcode) and ${postcodes.length} postcodes.`,
);
