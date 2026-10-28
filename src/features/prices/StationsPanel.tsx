import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';

import { LazyStationMap } from '@/features/map/LazyStationMap';
import { MapLegend } from '@/features/map/MapLegend';
import { SelectedStation } from '@/features/map/SelectedStation';
import {
  clearOnMap,
  closeSelection,
  findSelected,
  pickInList,
  pickOnMap,
  type FocusTarget,
  type SelectionChange,
} from '@/features/map/selection';
import { useTheme } from '@/features/theme/useTheme';
import { REDUCED_MOTION, useMediaQuery, WIDE_SCREEN } from '@/lib/useMediaQuery';

import { cheapestPrice } from './priceAge';
import { StationList } from './StationList';
import styles from './StationsPanel.module.css';
import { useReorderAnimation } from './useReorderAnimation';
import { LIST_PAGE_SIZE } from './view';

import type { PricesResponse, StationPrice } from '../../../shared/api';
import type { ResultsLayout } from '../search/searchState';
import type { ReactNode, RefObject } from 'react';

export interface StationsPanelProps {
  data: PricesResponse;
  stations: StationPrice[];
  /** Identifies the search: a new one starts the list from its first batch again. */
  searchKey: string;
  now: Date;
  fuelName: string;
  /** The list's name, saying its order: "Stations, cheapest first". */
  listLabel: string;
  /** The sort and filters, as one string: the cards slide to their new places when it changes. */
  arrangement: string;
  /** From the URL. */
  station: string | null;
  view: ResultsLayout;
  onSelect: (station: string | null, view?: ResultsLayout) => void;
  /**
   * The List/Map switch's Map button (phones), in the toolbar above: where
   * focus goes when the card under the map closes.
   */
  mapButtonRef: RefObject<HTMLButtonElement | null>;
  /** On a wide screen: the results' heading and toolbar, at the top of the list's column. */
  listHeader: ReactNode;
}

/**
 * The results as a list and a map: side by side on a wide screen, one at a
 * time on a phone. Which station is selected and which view a phone shows
 * live in the URL (useSearchState); the rules for what each action does are
 * in features/map/selection.ts.
 */
export function StationsPanel({
  data,
  stations,
  searchKey,
  now,
  fuelName,
  listLabel,
  arrangement,
  station,
  view,
  onSelect,
  mapButtonRef,
  listHeader,
}: StationsPanelProps) {
  const wide = useMediaQuery(WIDE_SCREEN);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const { theme } = useTheme();
  const selected = findSelected(stations, station);

  const showList = wide || view === 'list';
  const showMap = wide || view === 'map';
  // Once shown, the map stays mounted (hidden) so going back to it on a
  // phone does not reload it. Until then it is not rendered, and MapLibre
  // is not downloaded.
  const [mapStarted, setMapStarted] = useState(showMap);
  if (showMap && !mapStarted) setMapStarted(true);

  // Bumped by every row that opens, so the map shows that station again
  // even if it was panned away while the row was open before.
  const [showRequest, setShowRequest] = useState(0);

  /*
   * How much of the list is shown: a batch, more on request, back to one
   * batch for a new search (not for the refresh of the same one). A station
   * picked on the map, or opened from a shared link, is listed with
   * everything cheaper than it, and stays listed after it is closed, so
   * Close can hand focus back to its button.
   */
  const [batches, setBatches] = useState({ searchKey, count: LIST_PAGE_SIZE });
  const selectedIndex = selected ? stations.indexOf(selected) : -1;
  const wanted = Math.max(
    batches.searchKey === searchKey ? batches.count : LIST_PAGE_SIZE,
    selectedIndex + 1,
  );
  if (batches.searchKey !== searchKey || batches.count !== wanted) {
    setBatches({ searchKey, count: wanted });
  }
  const listed = Math.min(stations.length, wanted);

  const listRef = useRef<HTMLOListElement>(null);
  useReorderAnimation(listRef, arrangement, reducedMotion);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget>({
    kind: 'stay',
  });

  /*
   * A change that hides the control that was used names where focus goes
   * instead. The target may not exist until the URL change has rendered, so
   * the move happens here, in the layout effect of that render: still inside
   * the task that asked for it (see the deferred-focus note in
   * eslint.config.js).
   */
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target.kind === 'stay') return;
    pendingFocus.current = { kind: 'stay' };
    if (target.kind === 'view-switch') mapButtonRef.current?.focus();
    if (target.kind === 'map') {
      // The card was removed with focus inside it, which leaves focus on
      // <body>. MapLibre's canvas is the map's one focusable element.
      const active = document.activeElement;
      if (active === null || active === document.body) {
        mapPanelRef.current?.querySelector('canvas')?.focus({ preventScroll: true });
      }
    }
    if (target.kind === 'list-button') {
      const items = listRef.current?.querySelectorAll<HTMLElement>('[data-station]') ?? [];
      const item = [...items].find((element) => element.dataset.station === target.station);
      item?.querySelector('button')?.focus();
    }
  });

  const apply = (change: SelectionChange) => {
    pendingFocus.current = change.focus;
    onSelect(change.station, change.view);
  };

  /*
   * Escape anywhere in the map's panel (the map, its zoom buttons) clears
   * the selection. In the card under the map it is the card's Close, which
   * the card handles itself first (and marks handled). A native listener on
   * the panel, which only catches what bubbles up from the controls inside
   * it: the panel itself is not interactive, and a React handler on it would
   * say it was.
   */
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !selected) return;
    event.preventDefault();
    apply(clearOnMap());
  });
  useEffect(() => {
    const panel = mapPanelRef.current;
    if (!panel) return;
    const listener = (event: KeyboardEvent) => {
      onEscape(event);
    };
    panel.addEventListener('keydown', listener);
    return () => {
      panel.removeEventListener('keydown', listener);
    };
  }, [mapStarted]);

  const count = stations.length;
  const cheapest = cheapestPrice(stations.map((s) => s.priceCents));
  const mapLabel = `Map of ${String(count)} ${count === 1 ? 'station' : 'stations'} selling ${fuelName}. The list has the same stations.`;

  return (
    <div className={styles.panel}>
      <div className={styles.columns}>
        <div className={styles.list} hidden={!showList}>
          {listHeader}
          <StationList
            stations={stations.slice(0, listed)}
            total={count}
            now={now}
            selected={selected?.stationCode ?? null}
            cheapest={cheapest}
            pageSize={LIST_PAGE_SIZE}
            reducedMotion={reducedMotion}
            label={listLabel}
            listRef={listRef}
            onPick={(code) => {
              const change = pickInList(code, selected?.stationCode ?? null);
              if (change.station !== null) setShowRequest((n) => n + 1);
              apply(change);
            }}
            onClose={(code) => {
              apply(closeSelection(code, 'list'));
            }}
            onShowMore={() => {
              // The button stays put while the new stations appear above it.
              // Focus goes to the first of them, where reading carries on.
              const next = stations[listed];
              if (next) pendingFocus.current = { kind: 'list-button', station: next.stationCode };
              setBatches({ searchKey, count: listed + LIST_PAGE_SIZE });
            }}
          />
        </div>
        {mapStarted && (
          <div className={styles.mapPanel} hidden={!showMap} ref={mapPanelRef}>
            <div className={styles.mapFrame}>
              <LazyStationMap
                automatic={wide}
                stations={stations}
                origin={data.origin}
                selected={selected?.stationCode ?? null}
                showRequest={showRequest}
                label={mapLabel}
                reducedMotion={reducedMotion}
                theme={theme}
                onPick={(code) => {
                  apply(pickOnMap(code));
                }}
                onClear={() => {
                  apply(clearOnMap());
                }}
              />
            </div>
            <MapLegend prices={stations.map((s) => s.priceCents)} />
            {/*
             * On a phone's map the list is hidden, so the card is here. On a
             * wide screen it is under the station's row, beside the map.
             */}
            {selected && !wide && (
              <SelectedStation
                station={selected}
                now={now}
                place="map"
                cheapest={cheapest}
                onClose={() => {
                  apply(closeSelection(selected.stationCode, 'map'));
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
