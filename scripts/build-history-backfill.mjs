/**
 * Builds price history from before our own snapshots began (23 Oct 2026),
 * from NSW FuelCheck's published monthly price history, and optionally
 * uploads it to Netlify Blobs.
 *
 *   netlify blobs:get fuel-finder snapshot/v1/latest > .history-backfill/snapshot.json
 *   node scripts/build-history-backfill.mjs --months 3
 *   node scripts/build-history-backfill.mjs --months 3 --upload
 *
 * REPRODUCIBLE: the month files are found through the data.nsw.gov.au CKAN
 * API by name ("FuelCheck Price History September 2026"), downloaded once into
 * .history-backfill/cache/, and the output depends only on those files and
 * the snapshot used to match stations to codes. The month before the window
 * is read too, only for the price each station opened the window on.
 *
 * OUTPUT: .history-backfill/stations/{code}.json, one per matched station, in
 * the format of netlify/lib/history/stationHistory.ts, and report.json with
 * how stations were matched. `--upload` writes each to
 * `history/v2/backfill/{code}` in the site's store. That needs
 * NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment, and makes no
 * API.NSW calls.
 *
 * LICENCE: the source is CC BY-SA (NSW Fair Trading, via data.nsw.gov.au).
 * What this writes is an adaptation (daily low, high and last), shared under
 * CC BY-SA 4.0; the app credits it wherever it is shown. See
 * docs/decisions.md, "Price history before our own".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { buildBackfill, parseEvents, readCsvRows, readXlsxRows } from './lib/fuelcheck-history.mjs';

const DATASET = 'fuel-check';
const CKAN = `https://data.nsw.gov.au/data/api/3/action/package_show?id=${DATASET}`;
const FUELS = ['U91', 'E10', 'P95', 'P98', 'DL', 'PDL', 'LPG', 'E85', 'B20'];
const STORE = 'fuel-finder';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const { values } = parseArgs({
  options: {
    months: { type: 'string', default: '3' },
    snapshot: { type: 'string', default: '.history-backfill/snapshot.json' },
    out: { type: 'string', default: '.history-backfill' },
    upload: { type: 'boolean', default: false },
  },
});

const out = values.out;
mkdirSync(join(out, 'cache'), { recursive: true });
mkdirSync(join(out, 'stations'), { recursive: true });

/** "FuelCheck Price History September 2026" -> { year: 2026, month: 9 }, or null. */
function monthOf(resourceName) {
  const match = /price history\s+([a-z]+)\s+(\d{4})/i.exec(resourceName);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(match[1].toLowerCase()));
  return month === -1 ? null : { year: Number(match[2]), month: month + 1 };
}

const key = ({ year, month }) => `${String(year)}-${String(month).padStart(2, '0')}`;

console.warn(`Reading the dataset's file list from ${CKAN}`);
const ckan = await (await fetch(CKAN)).json();
const monthly = ckan.result.resources
  .map((resource) => ({ resource, month: monthOf(resource.name) }))
  .filter((entry) => entry.month)
  .sort((a, b) => key(a.month).localeCompare(key(b.month)));
const count = Number(values.months);
// The window, and the month before it for opening prices.
const chosen = monthly.slice(-(count + 1));
if (chosen.length < count + 1)
  throw new Error(`Only ${String(monthly.length)} monthly files listed`);
const window = chosen.slice(1);
const from = `${key(window[0].month)}-01`;
const last = window.at(-1).month;
const through = new Date(Date.UTC(last.year, last.month, 0)).toISOString().slice(0, 10);
console.warn(`Window: ${from} to ${through}, opening prices from ${key(chosen[0].month)}`);

const events = [];
const sources = [];
for (const { resource, month } of chosen) {
  const url = resource.url;
  const extension = url.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const cached = join(out, 'cache', `${key(month)}.${extension}`);
  if (!existsSync(cached)) {
    console.warn(`Downloading ${resource.name} (${(resource.size / 1e6).toFixed(1)} MB)`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(cached);
  // A file named .xlsx is sometimes listed as CSV and vice versa: trust the bytes.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const rows = isZip ? readXlsxRows(bytes) : readCsvRows(bytes.toString('utf8'));
  const parsed = parseEvents(rows);
  console.warn(
    `  ${key(month)}: ${String(parsed.events.length)} changes, ${String(parsed.rejected)} rows rejected`,
  );
  for (const event of parsed.events) events.push(event);
  sources.push({ name: resource.name, url, month: key(month), changes: parsed.events.length });
}

const snapshot = JSON.parse(readFileSync(values.snapshot, 'utf8'));
const { files, report } = buildBackfill({
  events,
  stations: snapshot.stations,
  from,
  through,
  fuels: FUELS,
});
for (const [code, file] of files) {
  writeFileSync(join(out, 'stations', `${code}.json`), JSON.stringify(file));
}
const summary = {
  from,
  through,
  snapshotFetchedAt: snapshot.fetchedAt,
  sources,
  stations: files.size,
  ...report,
};
writeFileSync(join(out, 'report.json'), JSON.stringify(summary, null, 2));
const matched = report.byAddress + report.byNameAndPostcode;
console.warn(
  `Matched ${String(matched)} of ${String(matched + report.unmatched.length)} stations ` +
    `(${String(report.byAddress)} by address, ${String(report.byNameAndPostcode)} by name and postcode), ` +
    `${((100 * report.matchedEvents) / report.events).toFixed(1)}% of changes. ` +
    `${String(files.size)} station files in ${join(out, 'stations')}.`,
);

if (values.upload) {
  const { getStore } = await import('@netlify/blobs');
  const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
  if (!siteID || !token) throw new Error('--upload needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN');
  const store = getStore({ name: STORE, siteID, token });
  const entries = [...files];
  let done = 0;
  // A few at a time: Blobs is happy with this, and a failure stops early.
  for (let i = 0; i < entries.length; i += 16) {
    await Promise.all(
      entries
        .slice(i, i + 16)
        .map(([code, file]) => store.setJSON(`history/v2/backfill/${code}`, file)),
    );
    done += Math.min(16, entries.length - i);
    if (done % 400 < 16) console.warn(`  uploaded ${String(done)} of ${String(entries.length)}`);
  }
  console.warn(`Uploaded ${String(done)} station files to history/v2/backfill/.`);
}
