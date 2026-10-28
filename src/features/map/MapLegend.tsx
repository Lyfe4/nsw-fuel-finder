import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatPrice } from '@/lib/format';

import styles from './MapLegend.module.css';

/**
 * What the dot colours mean, as the docket's scale bar, on one line:
 * "Cheapest 233.9 [blue|grey|orange] 254.9 Dearest  (ring) Centre". The
 * bands are thirds of these results by rank, from the cheapest end to the
 * dearest, and the words at each end say which end is which. A screen
 * reader gets the whole key as a sentence instead.
 *
 * Colour is never the only cue: prices are beside the dots where they fit,
 * the cheapest says "Cheapest", and the list has every station in price
 * order. Blue to grey to orange stays readable with every common colour
 * blindness (src/styles/tokens.test.ts checks it).
 */
export function MapLegend({ prices }: { prices: readonly number[] }) {
  if (prices.length === 0) return null;
  const lowest = formatPrice(Math.min(...prices));
  const highest = formatPrice(Math.max(...prices));
  return (
    <div className={styles.legend}>
      <p className={styles.key} aria-hidden="true">
        <span>
          Cheapest <span className={styles.figure}>{lowest}</span>
        </span>
        <span className={styles.bar}>
          <span className={styles.low} />
          <span className={styles.mid} />
          <span className={styles.high} />
        </span>
        <span>
          <span className={styles.figure}>{highest}</span> Dearest
        </span>
        <span className={styles.origin}>
          <span className={styles.ring} /> Centre
        </span>
      </p>
      <VisuallyHidden>
        Map key: blue dots are the cheapest third of these stations, grey the middle third, orange
        the dearest third, from {lowest} to {highest} cents a litre. A ring around a dot is the
        centre of the search.
      </VisuallyHidden>
    </div>
  );
}
