import { describe, expect, it } from 'vitest';

import { station } from '@/lib/testing/fakeApi';

import { clearOnMap, closeSelection, findSelected, pickInList, pickOnMap } from './selection';

describe('list and map selection', () => {
  describe('a station’s row in the list', () => {
    it('opens it (selects it) and leaves focus on the row', () => {
      expect(pickInList('42', null)).toEqual({ station: '42', focus: { kind: 'stay' } });
    });

    it('moves the selection from another station', () => {
      expect(pickInList('42', '7')).toEqual({ station: '42', focus: { kind: 'stay' } });
    });

    it('pressed again, closes it, focus still on the row', () => {
      expect(pickInList('42', '42')).toEqual({ station: null, focus: { kind: 'stay' } });
    });

    it('never changes the view: on a phone the list stays', () => {
      expect(pickInList('42', null)).not.toHaveProperty('view');
    });
  });

  it('a station picked on the map is selected without moving focus or changing view', () => {
    expect(pickOnMap('42')).toEqual({ station: '42', focus: { kind: 'stay' } });
  });

  describe('closing the card', () => {
    it('under its row, returns focus to the row', () => {
      expect(closeSelection('42', 'list')).toEqual({
        station: null,
        focus: { kind: 'list-button', station: '42' },
      });
    });

    it('under a phone’s map, returns focus to the Map switch, the list being hidden', () => {
      expect(closeSelection('42', 'map')).toEqual({
        station: null,
        focus: { kind: 'view-switch' },
      });
    });
  });

  describe('clearing from the map', () => {
    it('a tap on nothing clears it; focus stays, unless it was lost with the card', () => {
      expect(clearOnMap()).toEqual({ station: null, focus: { kind: 'map' } });
    });
  });

  describe('findSelected', () => {
    const stations = [station({ stationCode: '1' }), station({ stationCode: '2' })];

    it('finds the station the URL names', () => {
      expect(findSelected(stations, '2')?.stationCode).toBe('2');
    });

    it('ignores a station that is not in these results (a new fuel, or a stale link)', () => {
      expect(findSelected(stations, '99')).toBeNull();
      expect(findSelected(stations, null)).toBeNull();
    });
  });
});
