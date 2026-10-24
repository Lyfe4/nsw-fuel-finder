// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { stationHistorySchema } from './stationHistory';
import {
  buildBackfill,
  dailyRows,
  localTime,
  parseEvents,
  readCsvRows,
  readXlsxRows,
  type FuelCheckEvent,
} from '../../../scripts/lib/fuelcheck-history.mjs';

/*
 * The backfill script's own logic (scripts/lib/fuelcheck-history.mjs), tested
 * here so it runs with the rest of the suite and its output is checked
 * against the schema the API reads.
 */

const HEADER = [
  'ServiceStationName',
  'Address',
  'Suburb',
  'Postcode',
  'Brand',
  'FuelCode',
  'PriceUpdatedDate',
  'Price',
];

/** A minimal XLSX like FuelCheck's: two title rows, shared strings, Excel serial dates. */
function xlsx(rows: (string | number)[][]): Uint8Array {
  const strings: string[] = [];
  const shared = (text: string) => {
    const at = strings.indexOf(text);
    if (at !== -1) return at;
    strings.push(text);
    return strings.length - 1;
  };
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const columns = 'ABCDEFGH';
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columns[c] ?? 'A'}${String(r + 1)}`;
          return typeof value === 'number'
            ? `<c r="${ref}"><v>${String(value)}</v></c>`
            : `<c r="${ref}" t="s"><v>${String(shared(value))}</v></c>`;
        })
        .join('');
      return `<row r="${String(r + 1)}">${cells}</row>`;
    })
    .join('');
  const sst = strings.map((text) => `<si><t>${escape(text)}</t></si>`).join('');
  return zipSync({
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(`<sst>${sst}</sst>`),
  });
}

const event = (time: string, price: number, fuel = 'U91'): FuelCheckEvent => ({
  name: 'Ampol Erina',
  address: '1 Main Rd, ERINA NSW 2250',
  postcode: '2250',
  fuel,
  time,
  price,
});

describe('reading FuelCheck history files', () => {
  it('reads an XLSX file: title rows skipped, entities decoded, Excel dates as Sydney time', () => {
    const rows = readXlsxRows(
      xlsx([
        ['FC-R07-Price History Checks'],
        ['Time run: 13/10/2026 11:40:02 AM'],
        HEADER,
        // 46282.6111... is 17 Sep 2026 14:40:00.
        [
          '7-Eleven Kensington',
          '110 Anzac Pde & Goodwood St, Kensington NSW 2033',
          'Kensington',
          '2033',
          '7-Eleven',
          'U91',
          46282.611111111,
          201.9,
        ],
      ]),
    );
    const { events } = parseEvents(rows);
    expect(events).toEqual([
      {
        name: '7-Eleven Kensington',
        address: '110 Anzac Pde & Goodwood St, Kensington NSW 2033',
        postcode: '2033',
        fuel: 'U91',
        time: '2026-09-17T14:40:00',
        price: 201.9,
      },
    ]);
  });

  it('reads a CSV file: BOM, quoted commas, CRLF and text dates', () => {
    const csv =
      '﻿' +
      HEADER.join(',') +
      '\r\nAstron Yagoona,"45 ROOKWOOD RD, YAGOONA NSW 2199",YAGOONA,2199,ASTRON,E10,2026-03-01 00:05:26,194.9\r\n';
    const { events } = parseEvents(readCsvRows(csv));
    expect(events).toMatchObject([
      { address: '45 ROOKWOOD RD, YAGOONA NSW 2199', time: '2026-03-01T00:05:26', price: 194.9 },
    ]);
  });

  it('rejects rows with no date or an impossible price, and fails without a header', () => {
    const { events, rejected } = parseEvents([
      HEADER,
      ['A', 'B', 'C', '2000', 'D', 'U91', '', '200'],
      ['A', 'B', 'C', '2000', 'D', 'U91', '2026-03-01 00:00:00', '0'],
      ['A', 'B', 'C', '2000', 'D', 'U91', '2026-03-01 00:00:00', '2019'],
    ]);
    expect(events).toEqual([]);
    expect(rejected).toBe(3);
    expect(() => parseEvents([['nope']])).toThrow(/No header row/);
  });

  it('turns an Excel serial into wall-clock time with no time-zone shift', () => {
    expect(localTime(46266)).toBe('2026-09-01T00:00:00');
    expect(localTime('46266.5')).toBe('2026-09-01T12:00:00');
    expect(localTime('not a date')).toBeNull();
  });
});

describe('daily rows from price changes', () => {
  it('counts the price a day opens on, carries it through quiet days, and starts at the first known price', () => {
    const rows = dailyRows(
      [
        event('2026-06-30T18:00:00', 200), // before the window: only the opening price
        event('2026-07-01T09:00:00', 195),
        event('2026-07-01T15:00:00', 205),
        event('2026-07-03T08:00:00', 199),
      ],
      '2026-07-01',
      '2026-07-03',
    );
    expect(rows).toEqual([
      ['2026-07-01', 195, 205, 205],
      ['2026-07-02', 205, 205, 205],
      ['2026-07-03', 199, 205, 199],
    ]);
  });

  it('has no rows before the first price it knows', () => {
    expect(dailyRows([event('2026-07-02T10:00:00', 210)], '2026-07-01', '2026-07-02')).toEqual([
      ['2026-07-02', 210, 210, 210],
    ]);
  });
});

describe('building the backfill', () => {
  const stations = [
    { code: '1', name: 'Ampol Erina', address: '1 Main Road, Erina NSW 2250', postcode: '2250' },
    { code: '2', name: 'Shell Gosford', address: '9 Other St, Gosford NSW 2250', postcode: '2250' },
    { code: '3', name: 'Twin A', address: '5 Same St, Town NSW 2000', postcode: '2000' },
    { code: '4', name: 'Twin B', address: '5 Same St, Town NSW 2000', postcode: '2000' },
  ];

  it('matches by address, then name and postcode, and leaves the ambiguous out', () => {
    const { files, report } = buildBackfill({
      events: [
        // Same address written differently: matched.
        { ...event('2026-07-01T09:00:00', 200), address: '1 MAIN ROAD,  Erina NSW 2250' },
        // Address changed, name and postcode the same: matched by name.
        { ...event('2026-07-01T09:00:00', 210), name: 'Shell Gosford', address: '9 Other Street' },
        // Two of ours at that address, and no name match: left out.
        {
          ...event('2026-07-01T09:00:00', 220),
          name: 'Twin',
          address: '5 Same St, Town NSW 2000',
          postcode: '2000',
        },
      ],
      stations,
      from: '2026-07-01',
      through: '2026-07-01',
      fuels: ['U91'],
    });
    expect([...files.keys()]).toEqual(['1', '2']);
    expect(report).toMatchObject({
      byAddress: 1,
      byNameAndPostcode: 1,
      events: 3,
      matchedEvents: 2,
    });
    expect(report.unmatched).toHaveLength(1);
  });

  it('writes files the API can read', () => {
    const { files } = buildBackfill({
      events: [event('2026-07-01T09:00:00', 200), event('2026-07-02T09:00:00', 201, 'E10')],
      stations,
      from: '2026-07-01',
      through: '2026-07-02',
      fuels: ['U91', 'E10'],
    });
    const file = files.get('1');
    expect(stationHistorySchema.parse(file)).toEqual(file);
    expect(file?.fuels).toEqual({
      U91: [
        ['2026-07-01', 200, 200, 200],
        ['2026-07-02', 200, 200, 200],
      ],
      E10: [['2026-07-02', 201, 201, 201]],
    });
  });
});
