import { describe, expect, it } from 'vitest';

import { station } from '@/lib/testing/fakeApi';

import {
  clearOnMap,
  closeSelection,
  escapeSelection,
  findSelected,
  pickOnMap,
  showInList,
  showOnMap,
} from './selection';

describe('list and map selection', () => {
  describe('"Show on map" in the list', () => {
    it('on a wide screen selects the station and leaves focus on the button', () => {
      expect(showOnMap('42', 'wide')).toEqual({ station: '42', focus: { kind: 'stay' } });
    });

    it('on a phone switches to the map and moves focus to the card, since the list goes away', () => {
      expect(showOnMap('42', 'narrow')).toEqual({
        station: '42',
        view: 'map',
        focus: { kind: 'card' },
      });
    });
  });

  it('a station picked on the map is selected without moving focus or changing view', () => {
    expect(pickOnMap('42')).toEqual({ station: '42', focus: { kind: 'stay' } });
  });

  it('"Show in list" goes back to the list with focus on that station’s button', () => {
    expect(showInList('42')).toEqual({
      station: '42',
      view: 'list',
      focus: { kind: 'list-button', station: '42' },
    });
  });

  describe('closing the card', () => {
    it('on a wide screen returns focus to the station’s list button', () => {
      expect(closeSelection('42', 'wide')).toEqual({
        station: null,
        focus: { kind: 'list-button', station: '42' },
      });
    });

    it('on a phone returns focus to the Map switch, the list being hidden', () => {
      expect(closeSelection('42', 'narrow')).toEqual({
        station: null,
        focus: { kind: 'view-switch' },
      });
    });
  });

  describe('clearing from the map', () => {
    it('a tap on nothing clears it; focus stays, unless it was lost with the card', () => {
      expect(clearOnMap()).toEqual({ station: null, focus: { kind: 'map' } });
    });

    it('Escape on the map is the same as a tap on nothing', () => {
      expect(escapeSelection('42', 'wide', false)).toEqual(clearOnMap());
      expect(escapeSelection('42', 'narrow', false)).toEqual(clearOnMap());
    });

    it('Escape in the card is the card’s Close', () => {
      expect(escapeSelection('42', 'wide', true)).toEqual(closeSelection('42', 'wide'));
      expect(escapeSelection('42', 'narrow', true)).toEqual(closeSelection('42', 'narrow'));
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
