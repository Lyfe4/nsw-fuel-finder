import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/Button/Button';

import styles from './LazyStationMap.module.css';
import { chooseMap, drawsInSoftware, mapChosen, whenIdle } from './mapStart';
import { warmMapResources } from './mapStyle';

import type { StationMapProps } from './StationMap';

/*
 * The only way into StationMap. The dynamic import puts MapLibre, its worker
 * and its stylesheet in their own chunks, fetched the first time a map is
 * started: on a wide screen with results once the list has rendered and the
 * browser is idle, and on a phone only when the Map view is chosen.
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

export interface LazyStationMapProps extends Omit<StationMapProps, 'focusOnStart'> {
  /**
   * Start without being asked: a wide screen, where the map sits beside the
   * list. A phone's map is only rendered once the visitor has chosen it.
   */
  automatic: boolean;
}

/** Waiting for the browser to be idle; offering a button (software WebGL, see mapStart.ts); started. */
type Start = 'waiting' | 'offered' | 'started';

export function LazyStationMap({ automatic, ...props }: LazyStationMapProps) {
  const [start, setStart] = useState<Start>(() =>
    automatic && !mapChosen() ? 'waiting' : 'started',
  );
  /*
   * Opening a station's row does not start a map that is waiting to be
   * asked (software WebGL): the row is how a station is read now, and the
   * software map's first draw would freeze the page for a second or more
   * every time. "Show the map" is the one way to start it.
   */

  // The "Show the map" button goes away when pressed. Focus goes to the
  // placeholder while MapLibre downloads, then to the map itself.
  const [pressed, setPressed] = useState(false);
  const fallbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (start !== 'waiting') return;
    return whenIdle(() => {
      setStart(drawsInSoftware() ? 'offered' : 'started');
    });
  }, [start]);

  useLayoutEffect(() => {
    if (pressed) fallbackRef.current?.focus();
  }, [pressed]);

  // While MapLibre downloads, fetch the style and tile index it will ask for
  // next (see mapStyle.ts), and the other theme's when the page switches.
  // Nothing is fetched from OpenFreeMap before the map starts.
  useEffect(() => {
    if (start === 'started') warmMapResources(props.theme);
  }, [start, props.theme]);

  if (start === 'waiting') return <p className={styles.placeholder}>Loading map…</p>;

  if (start === 'offered') {
    return (
      <div className={[styles.placeholder, styles.asking].filter(Boolean).join(' ')}>
        <p className={styles.offer}>
          This device draws maps without graphics acceleration, which slows the page down, so the
          map waits until you ask for it. Every station is in the list.
        </p>
        <Button
          onClick={() => {
            chooseMap();
            setPressed(true);
            setStart('started');
          }}
        >
          Show the map
        </Button>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <Suspense
        fallback={
          <p className={styles.placeholder} ref={fallbackRef} tabIndex={-1}>
            Loading map…
          </p>
        }
      >
        <StationMap {...props} focusOnStart={pressed} />
      </Suspense>
    </MapErrorBoundary>
  );
}
