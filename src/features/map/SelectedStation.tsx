import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { FavouriteButton } from '@/features/favourites/FavouriteButton';
import { HistoryLink } from '@/features/history/HistoryLink';
import { DirectionsLink } from '@/features/prices/DirectionsLink';
import { PriceChange } from '@/features/prices/PriceChange';
import { formatAge, formatDistance, formatPrice } from '@/lib/format';

import styles from './SelectedStation.module.css';

import type { StationPrice } from '../../../shared/api';
import type { Ref } from 'react';

export interface SelectedStationProps {
  station: StationPrice;
  now: Date;
  /** Phones only: the list is not on screen beside the map. */
  onShowInList?: () => void;
  onClose: () => void;
  /** Focusable (tabIndex -1): where focus goes when a phone switches to the map for this station. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The selected station, under the map. On a phone in Map view this is the
 * only place its details are on screen; on a wide screen it repeats the
 * highlighted list item next to the map it belongs to.
 */
export function SelectedStation({
  station,
  now,
  onShowInList,
  onClose,
  headingRef,
}: SelectedStationProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.name} tabIndex={-1} ref={headingRef}>
        <HistoryLink code={station.stationCode}>{station.name}</HistoryLink>
      </h3>
      <p className={styles.price}>
        <span className={styles.amount}>{formatPrice(station.priceCents)}</span>{' '}
        <span aria-hidden="true">¢/L</span>
        <VisuallyHidden>cents a litre</VisuallyHidden>
        <span className={styles.age}>, updated {formatAge(station.priceUpdatedAt, now)}</span>{' '}
        <PriceChange cents={station.changeCents} />
      </p>
      <p>
        {station.brand} · {formatDistance(station.distanceKm)} away
      </p>
      <p className={styles.address}>{station.address}</p>
      <div className={styles.actions}>
        {onShowInList && <Button onClick={onShowInList}>Show in list</Button>}
        <DirectionsLink station={station} />
        <FavouriteButton code={station.stationCode} name={station.name} />
        <Button onClick={onClose}>
          Close<VisuallyHidden>, {station.name}</VisuallyHidden>
        </Button>
      </div>
    </div>
  );
}
