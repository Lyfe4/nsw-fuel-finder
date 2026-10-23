import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fakeGeolocation } from '@/lib/testing/geolocation';

import { GEOLOCATION_OPTIONS, useGeolocation } from './useGeolocation';

function setup() {
  const onLocated = vi.fn();
  const hook = renderHook(() => useGeolocation(onLocated));
  return { ...hook, onLocated };
}

describe('useGeolocation', () => {
  it('does not ask until asked', () => {
    const geo = fakeGeolocation();
    const { result } = setup();
    expect(result.current.status).toBe('idle');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('reports locating, then the precise position when granted', () => {
    const geo = fakeGeolocation();
    const { result, onLocated } = setup();

    act(() => {
      result.current.locate();
    });
    expect(result.current.status).toBe('locating');
    expect(geo.getCurrentPosition.mock.calls[0]?.[2]).toEqual(GEOLOCATION_OPTIONS);

    geo.succeed(-33.867812, 151.207321);
    expect(result.current).toMatchObject({
      status: 'located',
      position: { latitude: -33.867812, longitude: 151.207321 },
    });
    expect(onLocated).toHaveBeenCalledWith({ latitude: -33.867812, longitude: 151.207321 });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('reports error code %d as %s', (code, status) => {
    const geo = fakeGeolocation();
    const { result, onLocated } = setup();
    act(() => {
      result.current.locate();
    });
    geo.fail(code);
    expect(result.current.status).toBe(status);
    expect(onLocated).not.toHaveBeenCalled();
  });

  it('times out after ten seconds rather than hanging', () => {
    expect(GEOLOCATION_OPTIONS.timeout).toBe(10_000);
  });

  it('reports unsupported when the browser has no geolocation', () => {
    // jsdom, like some browsers in some contexts, has no navigator.geolocation.
    const { result } = setup();
    act(() => {
      result.current.locate();
    });
    expect(result.current.status).toBe('unsupported');
  });

  it('ignores an answer that arrives after the user searched another way', () => {
    const geo = fakeGeolocation();
    const { result, onLocated } = setup();
    act(() => {
      result.current.locate();
    });
    act(() => {
      result.current.reset();
    });
    geo.succeed(-33.87, 151.21);
    expect(result.current.status).toBe('idle');
    expect(onLocated).not.toHaveBeenCalled();
  });

  it('ignores the answer to an older request when asked twice', () => {
    const geo = fakeGeolocation();
    const { result, onLocated } = setup();
    act(() => {
      result.current.locate();
      result.current.locate();
    });
    geo.fail(3, 0);
    expect(result.current.status).toBe('locating');
    geo.succeed(-33.87, 151.21, 1);
    expect(result.current.status).toBe('located');
    expect(onLocated).toHaveBeenCalledTimes(1);
  });
});
