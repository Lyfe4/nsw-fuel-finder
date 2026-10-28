import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatPrice } from '@/lib/format';

import { FILL_LITRES, formatDollars, priceSummary } from './fillSaving';
import styles from './PriceSummaryLine.module.css';

import type { StationPrice } from '../../../shared/api';

/**
 * Beside the heading, the docket's total in a few words: "save $3.02 on
 * 50 L", or "average 239.9" when the saving is too small to mention. The
 * cheapest price is already the first row's.
 *
 * Screen readers get the whole sentence instead, as one piece of plain text:
 * "Cheapest 189.9, average 201.3 cents a litre. Filling 50 litres at the
 * cheapest saves $5.70 on the average." The short visible version is hidden
 * from them, and the sentence has no inline elements, so VoiceOver on iOS
 * reads it in one swipe (round 8 saw it read in five fragments).
 *
 * Of the stations shown, after any filters. No saving under 50 cents: "saves
 * $0.20" is noise.
 */
export function PriceSummaryLine({ stations }: { stations: readonly StationPrice[] }) {
  const summary = priceSummary(stations);
  if (!summary) return null;
  const cheapest = formatPrice(summary.cheapest);
  const average = formatPrice(summary.average);
  const saving = summary.saving >= 0.5 ? formatDollars(summary.saving) : null;
  const savingText = saving
    ? ` Filling ${String(FILL_LITRES)} litres at the cheapest saves ${saving} on the average.`
    : '';
  return (
    <p className={styles.summary}>
      <span aria-hidden="true">
        {saving ? (
          <>
            save <strong className={styles.figure}>{saving}</strong> on {FILL_LITRES} L
          </>
        ) : (
          <>
            average <strong className={styles.figure}>{average}</strong>
          </>
        )}
      </span>
      <VisuallyHidden>
        {`Cheapest ${cheapest}, average ${average} cents a litre.${savingText}`}
      </VisuallyHidden>
    </p>
  );
}
