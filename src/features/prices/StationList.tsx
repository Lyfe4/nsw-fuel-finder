import { useEffect, useEffectEvent, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { FavouriteButton } from '@/features/favourites/FavouriteButton';
import { HistoryLink } from '@/features/history/HistoryLink';
import { formatDistance, formatPrice } from '@/lib/format';

import { DirectionsLink } from './DirectionsLink';
import { priceAge } from './priceAge';
import { PriceChange } from './PriceChange';
import styles from './StationList.module.css';

import type { StationPrice } from '../../../shared/api';
import type { Ref } from 'react';

export interface StationListProps {
  /** The stations to list now: the first batch, or more after "Show more". */
  stations: StationPrice[];
  /** How many there are in all. */
  total: number;
  now: Date;
  /** The selected station's code. */
  selected: string | null;
  /** The lowest price in all the results, or null when every price is the same. */
  cheapest: number | null;
  onShowOnMap: (code: string) => void;
  onShowMore: () => void;
  /** How many "Show more" adds. */
  pageSize: number;
  reducedMotion: boolean;
  /** The list's name, which says its order: "Stations, cheapest first". */
  label: string;
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
 * order (see docs/decisions.md, "Keyboard path to the map"). A 25 km search
 * in Sydney finds over 500 stations, so they come in batches: 500 Tab stops
 * would bury the page footer, and nobody compares the 300th-cheapest price.
 */
export function StationList({
  stations,
  total,
  now,
  selected,
  cheapest,
  onShowOnMap,
  onShowMore,
  pageSize,
  reducedMotion,
  label,
  listRef,
}: StationListProps) {
  const selectedItem = useRef<HTMLLIElement>(null);

  /*
   * Bring the selected station into view when it changes, for a station
   * picked on the map. Scrolling only: focus stays where it was. 'nearest'
   * does nothing when it is already in view, as it is after "Show on map".
   * Skipped while the list is hidden (a phone showing the map).
   */
  // An effect event: reads the motion setting without making it a reason to scroll.
  const reveal = useEffectEvent(() => {
    const item = selectedItem.current;
    if (!item || item.closest('[hidden]')) return;
    item.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  // Only on a new selection, not when motion settings change.
  useEffect(() => {
    reveal();
  }, [selected]);

  const remaining = total - stations.length;

  return (
    <>
      <ol className={styles.list} aria-label={label} ref={listRef}>
        {stations.map((station) => {
          const isSelected = station.stationCode === selected;
          const age = priceAge(station.priceUpdatedAt, now);
          return (
            <li
              key={station.stationCode}
              className={[styles.item, isSelected && styles.selected].filter(Boolean).join(' ')}
              data-station={station.stationCode}
              ref={isSelected ? selectedItem : undefined}
            >
              {/* Focusable from script only: "Show more" moves focus to the first new station. */}
              <h3 className={styles.name} tabIndex={-1}>
                <HistoryLink code={station.stationCode}>{station.name}</HistoryLink>
              </h3>
              <p className={styles.price}>
                <span className={styles.amount}>{formatPrice(station.priceCents)}</span>{' '}
                <span aria-hidden="true" className={styles.unit}>
                  ¢/L
                </span>
                <VisuallyHidden>cents a litre</VisuallyHidden>
                {station.priceCents === cheapest && (
                  <>
                    {' '}
                    <span className={styles.badge}>Cheapest</span>
                  </>
                )}
                <PriceChange cents={station.changeCents} className={styles.change} />
              </p>
              <p className={styles.meta}>
                {station.brand} · {formatDistance(station.distanceKm)} away
              </p>
              <p className={styles.address}>{station.address}</p>
              <p className={age.old ? styles.old : styles.updated}>
                {age.old ? <strong>Price {age.text}</strong> : `Price ${age.text}`}
              </p>
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
                <DirectionsLink station={station} />
                <FavouriteButton code={station.stationCode} name={station.name} />
                {isSelected && <span className={styles.shown}>Shown on map</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {total > pageSize && (
        <div className={styles.more}>
          {/* Polite: after "Show more", says how far the list now goes. */}
          <p role="status" className={styles.count}>
            {remaining > 0
              ? `Showing ${String(stations.length)} of ${String(total)} stations`
              : `Showing all ${String(total)} stations`}
          </p>
          {remaining > 0 && (
            <Button onClick={onShowMore}>Show {Math.min(pageSize, remaining)} more</Button>
          )}
        </div>
      )}
    </>
  );
}
