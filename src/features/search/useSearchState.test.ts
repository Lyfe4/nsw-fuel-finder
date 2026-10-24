import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSearchState } from './useSearchState';

const setup = (url = '/') => {
  window.history.replaceState(null, '', url);
  const startLength = window.history.length;
  const hook = renderHook(() => useSearchState());
  return { ...hook, pushed: () => window.history.length - startLength };
};

describe('useSearchState', () => {
  it('reads the search from the URL', () => {
    const { result } = setup('/?fuel=DL&query=Erina');
    expect(result.current).toMatchObject({
      fuel: 'DL',
      radius: 5,
      place: { kind: 'location', query: 'Erina' },
    });
  });

  it('pushes a new place, so Back returns to the previous search', () => {
    const { result, pushed } = setup('/?fuel=DL');
    act(() => {
      result.current.searchLocation('  Bondi   Beach ');
    });
    expect(window.location.search).toBe('?fuel=DL&query=Bondi+Beach');
    expect(result.current.place).toEqual({ kind: 'location', query: 'Bondi Beach' });
    expect(pushed()).toBe(1);
  });

  it('replaces for a fuel or radius change, so Back is not a walk through every fuel tried', () => {
    const { result, pushed } = setup('/?query=Erina');
    act(() => {
      result.current.setFuel('E10');
    });
    act(() => {
      result.current.setRadius(25);
    });
    expect(window.location.search).toBe('?fuel=E10&query=Erina&radius=25');
    expect(pushed()).toBe(0);
  });

  it('never writes a precise position into the URL', () => {
    const { result } = setup();
    act(() => {
      result.current.searchNearby(-33.867812, 151.207321);
    });
    expect(window.location.search).toBe('?fuel=U91&lat=-33.87&lng=151.21');
  });

  it('follows Back and Forward', () => {
    const { result } = setup('/?query=Erina');
    act(() => {
      window.history.replaceState(null, '', '/?query=Bondi');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.place).toEqual({ kind: 'location', query: 'Bondi' });
  });

  it('keeps both of two changes made in one event', () => {
    const { result } = setup('/?query=Erina');
    act(() => {
      result.current.setFuel('P98');
      result.current.setRadius(10);
    });
    expect(window.location.search).toBe('?fuel=P98&query=Erina&radius=10');
  });

  it('ignores an empty search rather than clearing the current one', () => {
    const { result, pushed } = setup('/?query=Erina');
    act(() => {
      result.current.searchLocation('   ');
    });
    expect(window.location.search).toBe('?query=Erina');
    expect(pushed()).toBe(0);
  });

  it('replaces for a station or view change, and a new place clears the station', () => {
    const { result, pushed } = setup('/?query=Erina');
    act(() => {
      result.current.selectStation('42', 'map');
    });
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map&station=42');
    act(() => {
      result.current.setView('list');
    });
    expect(window.location.search).toBe('?fuel=U91&query=Erina&station=42');
    expect(pushed()).toBe(0);

    act(() => {
      result.current.setFuel('E10');
    });
    expect(result.current.station).toBe('42');

    act(() => {
      result.current.searchLocation('Gosford');
    });
    expect(result.current.station).toBeNull();
    expect(pushed()).toBe(1);
  });
});
