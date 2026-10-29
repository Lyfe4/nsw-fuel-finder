import { useLayoutEffect, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { Summary } from '@/components/Disclosure/Summary';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { HistoryLink } from '@/features/history/HistoryLink';
import { formatAge, formatPrice } from '@/lib/format';
import { SOURCE_NAMES, stationSource } from '@/lib/sources';

import styles from './FavouritesPanel.module.css';
import { useFavouritePrices, useFavourites } from './useFavourites';

import type { FuelTypeCode } from '../../../shared/fuelTypes';

export interface FavouritesPanelProps {
  fuel: FuelTypeCode;
  fuelName: string;
  now: Date;
  /** Open when there is no search yet: that is when favourites are the point of the visit. */
  openByDefault: boolean;
  /**
   * The last one was removed and the panel went with it: where focus goes
   * instead of <body> (the results heading, or the search).
   */
  onEmptied: () => void;
}

/**
 * The favourite stations and their prices now, for the chosen fuel, cheapest
 * first. A native <details>: one Tab stop when closed, and its open state is
 * the browser's to announce. Open on a first visit; closed once there is a
 * search, so it does not push the results down on a phone.
 *
 * Not there at all until there is a favourite: an empty panel is a line of
 * nothing above the prices. The Favourite button in each station's card is
 * how the first one is made.
 */
export function FavouritesPanel({
  fuel,
  fuelName,
  now,
  openByDefault,
  onEmptied,
}: FavouritesPanelProps) {
  const { favourites, removeFavourite } = useFavourites();
  const prices = useFavouritePrices(favourites);
  const summaryRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /**
   * After Remove, focus goes to the next row's Remove; after the last one,
   * the panel is gone, so to what onEmptied names.
   */
  const focusAfterRemove = useRef<string | null>(null);

  useLayoutEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    const button = listRef.current?.querySelector<HTMLElement>(`[data-remove="${target}"]`);
    if (button) button.focus();
    else if (summaryRef.current) summaryRef.current.focus();
    else onEmptied();
  });

  const byCode = new Map(prices.data?.stations.map((s) => [s.stationCode, s]));
  const missing = new Set(prices.data?.missing);
  const rows = favourites
    .map((favourite) => {
      const station = byCode.get(favourite.code);
      const price = station?.prices[fuel];
      return { favourite, station, price };
    })
    .sort((a, b) => (a.price?.priceCents ?? Infinity) - (b.price?.priceCents ?? Infinity));

  const remove = (code: string) => {
    const index = rows.findIndex((row) => row.favourite.code === code);
    const next = rows[index + 1] ?? rows[index - 1];
    focusAfterRemove.current = next?.favourite.code ?? '';
    removeFavourite(code);
  };

  if (favourites.length === 0) return null;

  return (
    <details className={styles.panel} open={openByDefault}>
      <Summary className={styles.summary} ref={summaryRef}>
        Favourites ({favourites.length})
      </Summary>
      <ul className={styles.list} ref={listRef} aria-label={`Favourites, ${fuelName}`}>
        {rows.map(({ favourite, station, price }) => (
          <li key={favourite.code} className={styles.row}>
            <HistoryLink code={favourite.code} className={styles.name}>
              {station?.name ?? favourite.name}
            </HistoryLink>
            <span aria-hidden="true" className={styles.leader} />
            <p className={styles.detail}>
              {missing.has(favourite.code) ? (
                `${SOURCE_NAMES[stationSource(favourite.code)]} no longer lists this station.`
              ) : prices.isPending ? (
                'Loading price…'
              ) : prices.isError ? (
                'Price unavailable right now.'
              ) : price ? (
                <>
                  <span className={styles.amount}>{formatPrice(price.priceCents)}</span> cents a
                  litre, updated {formatAge(price.updatedAt, now)}
                </>
              ) : (
                `Does not sell ${fuelName}.`
              )}
            </p>
            <Button
              variant="quiet"
              className={styles.remove}
              data-remove={favourite.code}
              onClick={() => {
                remove(favourite.code);
              }}
            >
              Remove<VisuallyHidden>, {station?.name ?? favourite.name}</VisuallyHidden>
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
