/**
 * Reading NSW FuelCheck's published monthly price history, and turning it
 * into the daily [low, high, last] history the app charts.
 *
 * Pure functions, kept apart from the command line (build-history-backfill.mjs)
 * so they can be tested: scripts/lib/fuelcheck-history.test.ts.
 *
 * THE FILES (data.nsw.gov.au, dataset "fuel-check", CC BY-SA). One per month,
 * published a week or two after it ends, sometimes XLSX and sometimes CSV,
 * with the same eight columns:
 *
 *   ServiceStationName, Address, Suburb, Postcode, Brand, FuelCode,
 *   PriceUpdatedDate, Price
 *
 * One row per price change (about 150,000 a month), not one per day. There is
 * no station code, so stations are matched to ours by address, then by name
 * and postcode. Times are Sydney wall-clock: the files start at local
 * midnight on the 1st, and a change seen in our own snapshot (UTC) appears in
 * the file at the same instant in Sydney time. XLSX stores them as Excel
 * serial days, CSV as "2026-03-01 00:05:26".
 */
import { strFromU8, unzipSync } from 'fflate';

/** The format the app reads. Shared with netlify/lib/history/stationHistory.ts by hand. */
export const STATION_HISTORY_VERSION = 2;

const COLUMNS = [
  'ServiceStationName',
  'Address',
  'Suburb',
  'Postcode',
  'Brand',
  'FuelCode',
  'PriceUpdatedDate',
  'Price',
];

/** A price outside this range (cents a litre) is a typo in the source, not a price. */
const PLAUSIBLE_CENTS = { min: 50, max: 600 };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return ENTITIES[entity] ?? whole;
  });
}

/** "B12" -> 1 (zero-based column index). */
function columnIndex(reference) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Every row of an XLSX file's first sheet, as arrays of strings. */
export function readXlsxRows(buffer) {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (file) =>
      file.name === 'xl/sharedStrings.xml' || file.name === 'xl/worksheets/sheet1.xml',
  });
  const sheet = files['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('This XLSX file has no xl/worksheets/sheet1.xml');
  const shared = [];
  const sharedXml = files['xl/sharedStrings.xml'];
  if (sharedXml) {
    for (const [, item] of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const text = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
      shared.push(decodeXml(text));
    }
  }
  const rows = [];
  for (const [, row] of strFromU8(sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const [, attributes, body = ''] of row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '';
      const type = /t="(\w+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
      let value = raw ?? inline ?? '';
      if (type === 's') value = shared[Number(value)] ?? '';
      else value = decodeXml(value);
      cells[reference ? columnIndex(reference) : cells.length] = value;
    }
    rows.push(Array.from(cells, (cell) => cell ?? ''));
  }
  return rows;
}

/** Every row of a CSV file (RFC 4180 quoting, a leading BOM and CRLF allowed). */
export function readCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * A PriceUpdatedDate as Sydney wall-clock "YYYY-MM-DDTHH:MM:SS". Excel
 * serials count days from 30 Dec 1899 with no time zone, so the arithmetic is
 * done in UTC purely as a calendar.
 */
export function localTime(value) {
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(text) * 86_400) * 1000);
    return (
      `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    );
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (match) {
    const [, y, mo, d, h, mi, s = '00'] = match;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }
  return null;
}

/**
 * Price-change events from a file's rows. The header row is found by name,
 * not position: the XLSX files have two lines of report title above it.
 */
export function parseEvents(rows) {
  const headerAt = rows.findIndex((row) => COLUMNS.every((name) => row.includes(name)));
  if (headerAt === -1) {
    throw new Error(`No header row with the columns ${COLUMNS.join(', ')}`);
  }
  const header = rows[headerAt];
  const at = Object.fromEntries(COLUMNS.map((name) => [name, header.indexOf(name)]));
  const events = [];
  let rejected = 0;
  for (const row of rows.slice(headerAt + 1)) {
    if (row.every((cell) => cell === '')) continue;
    const time = localTime(row[at.PriceUpdatedDate] ?? '');
    const price = Math.round(Number(row[at.Price]) * 10) / 10;
    const fuel = (row[at.FuelCode] ?? '').trim();
    if (!time || !fuel || !(price >= PLAUSIBLE_CENTS.min && price <= PLAUSIBLE_CENTS.max)) {
      rejected += 1;
      continue;
    }
    events.push({
      name: (row[at.ServiceStationName] ?? '').trim(),
      address: (row[at.Address] ?? '').trim(),
      postcode: (row[at.Postcode] ?? '').trim(),
      fuel,
      time,
      price,
    });
  }
  return { events, rejected };
}

const normalise = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which of our stations each file station is. By address first (unique for
 * all but a handful), then by name within the postcode. Anything ambiguous is
 * left out rather than guessed: a chart on the wrong station is worse than
 * no chart.
 */
export function matchStations(events, stations) {
  const byAddress = new Map();
  const byName = new Map();
  const add = (map, key, code) => map.set(key, [...(map.get(key) ?? []), code]);
  for (const station of stations) {
    add(byAddress, normalise(station.address), station.code);
    add(byName, `${normalise(station.name)}|${station.postcode ?? ''}`, station.code);
  }
  const codes = new Map();
  const report = { byAddress: 0, byNameAndPostcode: 0, unmatched: [] };
  for (const event of events) {
    const key = `${event.name}|${event.address}|${event.postcode}`;
    if (codes.has(key)) continue;
    const address = byAddress.get(normalise(event.address)) ?? [];
    const name = byName.get(`${normalise(event.name)}|${event.postcode}`) ?? [];
    if (address.length === 1) {
      codes.set(key, address[0]);
      report.byAddress += 1;
    } else if (name.length === 1) {
      codes.set(key, name[0]);
      report.byNameAndPostcode += 1;
    } else {
      codes.set(key, null);
      report.unmatched.push({ name: event.name, address: event.address });
    }
  }
  return {
    codeFor: (event) => codes.get(`${event.name}|${event.address}|${event.postcode}`) ?? null,
    report,
  };
}

/** "2026-07-01" plus one day, as a calendar date. */
export function nextDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * One station's one fuel, from its change events to a row per day:
 * [day, low, high, last]. The price in force when a day starts counts towards
 * that day's low and high, so a day with no change still has a row, as long
 * as some earlier change told us the price. Days before the first known price
 * have no row.
 */
export function dailyRows(events, from, through) {
  const sorted = [...events].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const rows = [];
  let index = 0;
  let current = null;
  while (index < sorted.length && sorted[index].time < `${from}T00:00:00`) {
    current = sorted[index].price;
    index += 1;
  }
  for (let day = from; day <= through; day = nextDay(day)) {
    let low = current;
    let high = current;
    const end = `${nextDay(day)}T00:00:00`;
    while (index < sorted.length && sorted[index].time < end) {
      const { price } = sorted[index];
      low = low === null ? price : Math.min(low, price);
      high = high === null ? price : Math.max(high, price);
      current = price;
      index += 1;
    }
    if (current !== null && low !== null && high !== null) rows.push([day, low, high, current]);
  }
  return rows;
}

/**
 * Station history files from every event, one per matched station, covering
 * `from` to `through`. Events before `from` only set the opening price.
 */
export function buildBackfill({ events, stations, from, through, fuels }) {
  const { codeFor, report } = matchStations(events, stations);
  const grouped = new Map();
  let matchedEvents = 0;
  for (const event of events) {
    const code = codeFor(event);
    if (!code || !fuels.includes(event.fuel)) continue;
    matchedEvents += 1;
    let byFuel = grouped.get(code);
    if (!byFuel) grouped.set(code, (byFuel = new Map()));
    let list = byFuel.get(event.fuel);
    if (!list) byFuel.set(event.fuel, (list = []));
    list.push(event);
  }
  const files = new Map();
  for (const [code, byFuel] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const fuelRows = {};
    for (const fuel of fuels) {
      const rows = dailyRows(byFuel.get(fuel) ?? [], from, through);
      if (rows.length > 0) fuelRows[fuel] = rows;
    }
    if (Object.keys(fuelRows).length === 0) continue;
    files.set(code, {
      version: STATION_HISTORY_VERSION,
      code,
      source: 'fuelcheck-monthly',
      from,
      through,
      fuels: fuelRows,
    });
  }
  return { files, report: { ...report, events: events.length, matchedEvents } };
}
