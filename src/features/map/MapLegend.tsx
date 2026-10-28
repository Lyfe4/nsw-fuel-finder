import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatPrice } from '@/lib/format';

import styles from './MapLegend.module.css';

/**
 * What the dot colours mean, as the docket's scale bar: the three bands in
 * order, with the lowest and highest price at its ends and the words under
 * each band. The colours are relative to the stations shown, which the
 * words say ("cheapest third"), and they are never the only cue: prices are
 * beside the dots where they fit, the cheapest say "Cheapest", and the list
 * has every station in price order. Blue to grey to orange stays readable
 * with every common colour blindness (src/styles/tokens.test.ts checks it).
 */
export function MapLegend({ prices }: { prices: readonly number[] }) {
  if (prices.length === 0) return null;
  const lowest = formatPrice(Math.min(...prices));
  const highest = formatPrice(Math.max(...prices));
  return (
    <div className={styles.legend}>
      <p className={styles.title}>
        Map key
        <VisuallyHidden>
          , prices from {lowest} to {highest} cents a litre
        </VisuallyHidden>
      </p>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.low} />
        <span className={styles.mid} />
        <span className={styles.high} />
      </div>
      <ul className={styles.bands}>
        <li>
          <span aria-hidden="true" className={styles.figure}>
            {lowest}
          </span>{' '}
          Cheapest third
        </li>
        <li>Middle</li>
        <li>
          Dearest third{' '}
          <span aria-hidden="true" className={styles.figure}>
            {highest}
          </span>
        </li>
      </ul>
      <p className={styles.origin}>
        <span aria-hidden="true" className={styles.ring} /> Search centre
      </p>
    </div>
  );
}
