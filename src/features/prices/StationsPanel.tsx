import { useLayoutEffect, useRef, useState } from 'react';

import { LazyStationMap } from '@/features/map/LazyStationMap';
import { MapLegend } from '@/features/map/MapLegend';
import { SelectedStation } from '@/features/map/SelectedStation';
import {
  closeSelection,
  findSelected,
  pickOnMap,
  showInList,
  showOnMap,
  type FocusTarget,
  type ScreenWidth,
  type SelectionChange,
} from '@/features/map/selection';
import { ViewSwitch } from '@/features/map/ViewSwitch';
import { REDUCED_MOTION, useMediaQuery, WIDE_SCREEN } from '@/lib/useMediaQuery';

import { StationList } from './StationList';
import styles from './StationsPanel.module.css';

import type { PricesResponse, StationPrice } from '../../../shared/api';
import type { ResultsLayout } from '../search/searchState';

export interface StationsPanelProps {
  data: PricesResponse;
  stations: StationPrice[];
  now: Date;
  fuelName: string;
  /** From the URL. */
  station: string | null;
  view: ResultsLayout;
  onSelect: (station: string | null, view?: ResultsLayout) => void;
  onViewChange: (view: ResultsLayout) => void;
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
  now,
  fuelName,
  station,
  view,
  onSelect,
  onViewChange,
}: StationsPanelProps) {
  const wide = useMediaQuery(WIDE_SCREEN);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const width: ScreenWidth = wide ? 'wide' : 'narrow';
  const selected = findSelected(stations, station);

  const showList = wide || view === 'list';
  const showMap = wide || view === 'map';
  // Once shown, the map stays mounted (hidden) so going back to it on a
  // phone does not reload it. Until then it is not rendered, and MapLibre
  // is not downloaded.
  const [mapStarted, setMapStarted] = useState(showMap);
  if (showMap && !mapStarted) setMapStarted(true);

  // Bumped by every "Show on map", so the same station can be shown again.
  const [showRequest, setShowRequest] = useState(0);

  const listRef = useRef<HTMLOListElement>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget>({ kind: 'stay' });

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
    if (target.kind === 'card') {
      // Focusing the card would scroll just the card into view, leaving the
      // map above it off screen. Scroll the whole panel up to its bottom edge
      // instead: the map and the card together, on any phone tall enough.
      cardHeadingRef.current?.focus({ preventScroll: true });
      mapPanelRef.current?.scrollIntoView({ block: 'end' });
    }
    if (target.kind === 'view-switch') mapButtonRef.current?.focus();
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

  const count = stations.length;
  const mapLabel = `Map of ${String(count)} ${count === 1 ? 'station' : 'stations'} selling ${fuelName}. The list has the same stations.`;

  return (
    <div className={styles.panel}>
      {!wide && <ViewSwitch view={view} onChange={onViewChange} mapButtonRef={mapButtonRef} />}
      <div className={styles.columns}>
        <div className={styles.list} hidden={!showList}>
          <StationList
            stations={stations}
            now={now}
            selected={selected?.stationCode ?? null}
            reducedMotion={reducedMotion}
            listRef={listRef}
            onShowOnMap={(code) => {
              setShowRequest((n) => n + 1);
              apply(showOnMap(code, width));
            }}
          />
        </div>
        {mapStarted && (
          <div className={styles.mapPanel} hidden={!showMap} ref={mapPanelRef}>
            <div className={styles.mapFrame}>
              <LazyStationMap
                stations={stations}
                origin={data.origin}
                selected={selected?.stationCode ?? null}
                showRequest={showRequest}
                label={mapLabel}
                reducedMotion={reducedMotion}
                onPick={(code) => {
                  apply(pickOnMap(code));
                }}
              />
            </div>
            <MapLegend />
            {selected && (
              <SelectedStation
                station={selected}
                now={now}
                headingRef={cardHeadingRef}
                {...(wide
                  ? {}
                  : {
                      onShowInList: () => {
                        apply(showInList(selected.stationCode));
                      },
                    })}
                onClose={() => {
                  apply(closeSelection(selected.stationCode, width));
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
