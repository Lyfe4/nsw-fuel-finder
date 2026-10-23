import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatAge, formatDistance, formatPrice } from '@/lib/format';

import styles from './StationList.module.css';

import type { StationPrice } from '../../../shared/api';

/**
 * Cheapest first. Each station is a list item headed by its name, so a
 * screen reader user can jump station to station by heading; the price is
 * the biggest thing on screen but comes after the name in reading order,
 * which is how a sentence would put it.
 */
export function StationList({ stations, now }: { stations: StationPrice[]; now: Date }) {
  return (
    <ol className={styles.list} aria-label="Stations, cheapest first">
      {stations.map((station) => (
        <li key={station.stationCode} className={styles.item}>
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
        </li>
      ))}
    </ol>
  );
}
