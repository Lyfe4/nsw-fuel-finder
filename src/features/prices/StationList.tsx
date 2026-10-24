import { useEffect, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatAge, formatDistance, formatPrice } from '@/lib/format';

import styles from './StationList.module.css';

import type { StationPrice } from '../../../shared/api';
import type { Ref } from 'react';

export interface StationListProps {
  stations: StationPrice[];
  now: Date;
  /** The selected station's code. */
  selected: string | null;
  onShowOnMap: (code: string) => void;
  reducedMotion: boolean;
  listRef?: Ref<HTMLOListElement>;
}

/**
 * Cheapest first. Each station is a list item headed by its name, so a
 * screen reader user can jump station to station by heading; the price is
 * the biggest thing on screen but comes after the name in reading order,
 * which is how a sentence would put it.
 *
 * Each item's "Show on map" button is the keyboard way to the map: one Tab
 * stop per station, in price order. The map's own dots stay out of the Tab
 * order (see docs/decisions.md, "Keyboard path to the map").
 */
export function StationList({
  stations,
  now,
  selected,
  onShowOnMap,
  reducedMotion,
  listRef,
}: StationListProps) {
  const selectedItem = useRef<HTMLLIElement>(null);

  /*
   * Bring the selected station into view when it changes, for a station
   * picked on the map. Scrolling only: focus stays where it was. 'nearest'
   * does nothing when it is already in view, as it is after "Show on map".
   * Skipped while the list is hidden (a phone showing the map).
   */
  useEffect(() => {
    const item = selectedItem.current;
    if (!item || item.closest('[hidden]')) return;
    item.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    // Only on a new selection, not when motion settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <ol className={styles.list} aria-label="Stations, cheapest first" ref={listRef}>
      {stations.map((station) => {
        const isSelected = station.stationCode === selected;
        return (
          <li
            key={station.stationCode}
            className={[styles.item, isSelected && styles.selected].filter(Boolean).join(' ')}
            data-station={station.stationCode}
            ref={isSelected ? selectedItem : undefined}
          >
            <h3 className={styles.name}>{station.name}</h3>
            <p className={styles.price}>
              <span className={styles.amount}>{formatPrice(station.priceCents)}</span>{' '}
              <span aria-hidden="true" className={styles.unit}>
                ¢/L
              </span>
              <VisuallyHidden>cents a litre</VisuallyHidden>
            </p>
            <p className={styles.meta}>
              {station.brand} · {formatDistance(station.distanceKm)} away
            </p>
            <p className={styles.address}>{station.address}</p>
            <p className={styles.updated}>Price updated {formatAge(station.priceUpdatedAt, now)}</p>
            <div className={styles.actions}>
              <Button
                variant="quiet"
                className={styles.showOnMap}
                onClick={() => {
                  onShowOnMap(station.stationCode);
                }}
              >
                Show on map<VisuallyHidden>, {station.name}</VisuallyHidden>
              </Button>
              {isSelected && <span className={styles.shown}>Shown on map</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
