import { useEffect, useEffectEvent, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { SelectedStation } from '@/features/map/SelectedStation';
import { formatAge, formatDistance, formatPrice } from '@/lib/format';
import { SOURCE_NAMES, stationSource } from '@/lib/sources';

import { priceAge } from './priceAge';
import styles from './StationList.module.css';

import type { StationPrice } from '../../../shared/api';
import type { Ref } from 'react';

export interface StationListProps {
  /** The stations to list now: the first batch, or more after "Show more". */
  stations: StationPrice[];
  /** How many there are in all. */
  total: number;
  now: Date;
  /** The selected station's code: its row is open, its card under it. */
  selected: string | null;
  /** The lowest price in all the results, or null when every price is the same. */
  cheapest: number | null;
  /** A row pressed: open its card, or close it if it was open. */
  onPick: (code: string) => void;
  /** The open card's Close (or Escape in it). */
  onClose: (code: string) => void;
  onShowMore: () => void;
  /** How many "Show more" adds. */
  pageSize: number;
  reducedMotion: boolean;
  /** The list's name, which says its order: "Stations, cheapest first". */
  label: string;
  listRef?: Ref<HTMLOListElement>;
}

/**
 * Cheapest first, one line a station: name, a dotted leader, the price;
 * distance and age under it. Everything else is in the station's card, one
 * press away (docs/design-system.md, Station row).
 *
 * Each row is an <h3> holding one button, the WAI-ARIA accordion: one Tab
 * stop per station, and heading navigation still goes station by station.
 * The button's name is the row as one sentence ("Metro Gosford 233.9 cents a
 * litre, cheapest, 3.4 km away, updated 21 hours ago"); the leader and the
 * separators are hidden from it. Pressing it opens the card under it and
 * selects the station on the map, which makes the rows the keyboard way to
 * the map: the map's own dots stay out of the Tab order (see
 * docs/decisions.md, "Keyboard path to the map").
 *
 * A 25 km search in Sydney finds over 500 stations, so they come in batches:
 * 500 Tab stops would bury the page footer, and nobody compares the
 * 300th-cheapest price.
 */
export function StationList({
  stations,
  total,
  now,
  selected,
  cheapest,
  onPick,
  onClose,
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
   * does nothing when it is already in view, as it is after a press on its
   * row. Skipped while the list is hidden (a phone showing the map).
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
          const isCheapest = station.priceCents === cheapest;
          const old = priceAge(station.priceUpdatedAt, now).old;
          const age = formatAge(station.priceUpdatedAt, now);
          const cardId = `card-${station.stationCode}`;
          return (
            <li
              key={station.stationCode}
              className={[styles.item, isSelected && styles.selected].filter(Boolean).join(' ')}
              data-station={station.stationCode}
              ref={isSelected ? selectedItem : undefined}
            >
              <h3 className={styles.heading}>
                <button
                  type="button"
                  className={styles.row}
                  aria-expanded={isSelected}
                  aria-controls={isSelected ? cardId : undefined}
                  onClick={() => {
                    onPick(station.stationCode);
                  }}
                >
                  <span className={styles.top}>
                    <span className={styles.name}>{station.name}</span>{' '}
                    <span aria-hidden="true" className={styles.leader} />
                    <span className={isCheapest ? styles.cheapest : styles.amount}>
                      {formatPrice(station.priceCents)}
                    </span>
                  </span>{' '}
                  <VisuallyHidden>cents a litre{isCheapest ? ', cheapest' : ''},</VisuallyHidden>{' '}
                  <span className={styles.meta}>
                    <span>
                      {formatDistance(station.distanceKm)} <VisuallyHidden>away,</VisuallyHidden>{' '}
                      <span aria-hidden="true">·</span>{' '}
                      {old ? (
                        <strong className={styles.old}>
                          Old price, <VisuallyHidden>updated</VisuallyHidden> {age}
                        </strong>
                      ) : (
                        <>
                          <VisuallyHidden>updated</VisuallyHidden> {age}
                        </>
                      )}
                      {/* Queensland's licence, clause 4.4: its prices told apart in the list too. */}
                      {stationSource(station.stationCode) === 'qld' && (
                        <>
                          {' '}
                          <span aria-hidden="true">·</span> Qld
                          <VisuallyHidden>, price from {SOURCE_NAMES.qld}</VisuallyHidden>
                        </>
                      )}
                    </span>
                    {isCheapest && (
                      <span aria-hidden="true" className={styles.flag}>
                        Cheapest
                      </span>
                    )}
                  </span>
                </button>
              </h3>
              {isSelected && (
                <SelectedStation
                  station={station}
                  now={now}
                  place="list"
                  cheapest={cheapest}
                  id={cardId}
                  onClose={() => {
                    onClose(station.stationCode);
                  }}
                />
              )}
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
