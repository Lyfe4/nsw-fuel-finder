import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatPrice } from '@/lib/format';

import { FILL_LITRES, formatDollars, priceSummary } from './fillSaving';
import styles from './PriceSummaryLine.module.css';

import type { StationPrice } from '../../../shared/api';

/**
 * One sentence over the list: "Cheapest 189.9, average 201.3 cents a litre.
 * Filling 50 litres at the cheapest saves $5.70 on the average." Words, not a
 * row of stat boxes, so it needs no labels of its own.
 *
 * Screen readers get the same sentence as one piece of plain text. The
 * visible copy makes the numbers bold, and VoiceOver on iOS stops at every
 * inline element when swiping, which would read it as five fragments
 * (seen in Chromium's accessibility tree: "Cheapest", "222.5", ", average"...).
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
        Cheapest <strong>{cheapest}</strong>, average <strong>{average}</strong> cents a litre.
        {saving && (
          <>
            {' '}
            Filling {FILL_LITRES} litres at the cheapest saves <strong>{saving}</strong> on the
            average.
          </>
        )}
      </span>
      <VisuallyHidden>
        {`Cheapest ${cheapest}, average ${average} cents a litre.${savingText}`}
      </VisuallyHidden>
    </p>
  );
}
