import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatPrice } from '@/lib/format';

import styles from './PriceChange.module.css';

/**
 * How far a price has moved today, against the station's last price
 * yesterday: "↓ 2.0 today". Nothing when it has not moved (most stations,
 * most days) or when yesterday is unknown, so the ones that did move stand
 * out.
 *
 * Not colour alone: the arrow's direction and, for screen readers, the word
 * ("down 2.0 cents a litre since yesterday"). The arrow is hidden from them;
 * "downwards arrow" would add nothing.
 */
export function PriceChange({
  cents,
  className,
}: {
  cents: number | null;
  className?: string | undefined;
}) {
  if (cents === null || cents === 0) return null;
  const down = cents < 0;
  const amount = formatPrice(Math.abs(cents));
  return (
    <span className={[down ? styles.down : styles.up, className].filter(Boolean).join(' ')}>
      <span aria-hidden="true">
        {down ? '↓' : '↑'} {amount} today
      </span>
      <VisuallyHidden>
        {down ? 'down' : 'up'} {amount} cents a litre since yesterday
      </VisuallyHidden>
    </span>
  );
}
