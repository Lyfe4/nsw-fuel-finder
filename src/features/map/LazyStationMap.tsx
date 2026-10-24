import { Component, lazy, Suspense, type ReactNode } from 'react';

import styles from './LazyStationMap.module.css';

import type { StationMapProps } from './StationMap';

/*
 * The only way into StationMap. The dynamic import puts MapLibre, its worker
 * and its stylesheet in their own chunks, fetched the first time a map is
 * rendered: at once on a wide screen with results, and on a phone only when
 * the Map view is chosen.
 */
const StationMap = lazy(() =>
  import('./StationMap').then((module) => ({ default: module.StationMap })),
);

/**
 * A map that cannot be shown (no WebGL, or the chunk failed to download on a
 * flaky connection) must not take the list down with it.
 */
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn('Map failed to load', error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <p className={styles.placeholder}>
          The map couldn’t be shown on this device. Every station is in the list.
        </p>
      );
    }
    return this.props.children;
  }
}

export function LazyStationMap(props: StationMapProps) {
  return (
    <MapErrorBoundary>
      <Suspense fallback={<p className={styles.placeholder}>Loading map…</p>}>
        <StationMap {...props} />
      </Suspense>
    </MapErrorBoundary>
  );
}
