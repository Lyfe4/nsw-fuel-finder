import { useLayoutEffect, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { HistoryLink } from '@/features/history/HistoryLink';
import { formatAge, formatPrice } from '@/lib/format';

import styles from './FavouritesPanel.module.css';
import { useFavouritePrices, useFavourites } from './useFavourites';

import type { FuelTypeCode } from '../../../shared/fuelTypes';

export interface FavouritesPanelProps {
  fuel: FuelTypeCode;
  fuelName: string;
  now: Date;
  /** Open when there is no search yet: that is when favourites are the point of the visit. */
  openByDefault: boolean;
}

/**
 * The favourite stations and their prices now, for the chosen fuel, cheapest
 * first. A native <details>: one Tab stop when closed, and its open state is
 * the browser's to announce. Open on a first visit; closed once there is a
 * search, so it does not push the results down on a phone.
 */
export function FavouritesPanel({ fuel, fuelName, now, openByDefault }: FavouritesPanelProps) {
  const { favourites, removeFavourite } = useFavourites();
  const prices = useFavouritePrices(favourites);
  const summaryRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** After Remove, focus goes to the next row's Remove, or the panel's own summary. */
  const focusAfterRemove = useRef<string | null>(null);

  useLayoutEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    const button = listRef.current?.querySelector<HTMLElement>(`[data-remove="${target}"]`);
    (button ?? summaryRef.current)?.focus();
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

  return (
    <details className={styles.panel} open={openByDefault}>
      <summary className={styles.summary} ref={summaryRef}>
        Favourites{favourites.length > 0 ? ` (${String(favourites.length)})` : ''}
      </summary>
      {favourites.length === 0 ? (
        <p className={styles.empty}>
          No favourites yet. Choose <span aria-hidden="true">☆</span> Favourite on a station to keep
          it here, on this device.
        </p>
      ) : (
        <ul className={styles.list} ref={listRef} aria-label={`Favourites, ${fuelName}`}>
          {rows.map(({ favourite, station, price }) => (
            <li key={favourite.code} className={styles.row}>
              <div className={styles.text}>
                <HistoryLink code={favourite.code} className={styles.name}>
                  {station?.name ?? favourite.name}
                </HistoryLink>
                <p className={styles.detail}>
                  {missing.has(favourite.code)
                    ? 'FuelCheck no longer lists this station.'
                    : prices.isPending
                      ? 'Loading price…'
                      : prices.isError
                        ? 'Price unavailable right now.'
                        : price
                          ? `${formatPrice(price.priceCents)} cents a litre, updated ${formatAge(price.updatedAt, now)}`
                          : `Does not sell ${fuelName}.`}
                </p>
              </div>
              <Button
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
      )}
    </details>
  );
}
