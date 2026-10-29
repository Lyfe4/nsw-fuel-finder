import { useEffect, useEffectEvent, useRef } from 'react';

import { IconButton } from '@/components/Button/Button';
import { Close } from '@/components/Icon/icons';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { FavouriteButton } from '@/features/favourites/FavouriteButton';
import { HistoryLink } from '@/features/history/HistoryLink';
import { DirectionsLink } from '@/features/prices/DirectionsLink';
import { PriceChange } from '@/features/prices/PriceChange';
import { formatAddress, formatAge, formatDistance, formatPrice } from '@/lib/format';

import styles from './SelectedStation.module.css';

import type { CardPlace } from './selection';
import type { StationPrice } from '../../../shared/api';

export interface SelectedStationProps {
  station: StationPrice;
  now: Date;
  /**
   * 'list': under the station's own row, which already says its name, price,
   * distance and age. 'map': under the map on a phone, where it is the only
   * place the station's details are on screen, so it says them all.
   */
  place: CardPlace;
  /** The lowest price in the results, for "cheapest". */
  cheapest: number | null;
  /** Its id, for the row's aria-controls. */
  id?: string;
  onClose: () => void;
}

/**
 * The selected station: what the row leaves out (brand, address, today's
 * move), the way to its price history, and what can be done with it.
 * Escape anywhere inside it is its Close.
 */
export function SelectedStation({
  station,
  now,
  place,
  cheapest,
  id,
  onClose,
}: SelectedStationProps) {
  const card = useRef<HTMLDivElement>(null);

  // A native listener on the card, which is not itself interactive: only
  // what bubbles up from the controls inside it.
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  });
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const listener = (event: KeyboardEvent) => {
      onEscape(event);
    };
    element.addEventListener('keydown', listener);
    return () => {
      element.removeEventListener('keydown', listener);
    };
  }, []);

  const isCheapest = station.priceCents === cheapest;
  return (
    <div className={place === 'list' ? styles.inList : styles.onMap} id={id} ref={card}>
      {place === 'map' && (
        <>
          <div className={styles.top}>
            <h3 className={styles.name}>{station.name}</h3>
            <span aria-hidden="true" className={styles.leader} />
            <p className={isCheapest ? styles.cheapest : styles.amount}>
              {formatPrice(station.priceCents)}{' '}
              <VisuallyHidden>cents a litre{isCheapest ? ', cheapest' : ''}</VisuallyHidden>
            </p>
          </div>
          <p className={styles.detail}>
            {station.brand} <span aria-hidden="true">·</span> {formatDistance(station.distanceKm)}{' '}
            <VisuallyHidden>away,</VisuallyHidden> <span aria-hidden="true">·</span> updated{' '}
            {formatAge(station.priceUpdatedAt, now)}
          </p>
        </>
      )}
      <p className={styles.detail}>
        {place === 'list' && (
          <>
            {station.brand} <span aria-hidden="true">·</span>{' '}
          </>
        )}
        {formatAddress(station.address)}
        {station.changeCents !== null && station.changeCents !== 0 && (
          <>
            {' '}
            <span aria-hidden="true">·</span>{' '}
            <PriceChange cents={station.changeCents} className={styles.change} />
          </>
        )}
      </p>
      <p className={styles.history}>
        <HistoryLink code={station.stationCode}>
          Price history<VisuallyHidden>, {station.name}</VisuallyHidden>
        </HistoryLink>
      </p>
      <div className={styles.actions}>
        <DirectionsLink station={station} primary />
        <FavouriteButton code={station.stationCode} name={station.name} variant="secondary" />
        <IconButton
          icon={Close}
          label={`Close, ${station.name}`}
          title="Close"
          className={styles.close}
          onClick={onClose}
        />
      </div>
    </div>
  );
}
