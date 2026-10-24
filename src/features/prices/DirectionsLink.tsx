import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { directionsUrl } from '@/lib/directions';

import styles from './DirectionsLink.module.css';

import type { StationPrice } from '../../../shared/api';

/**
 * "Directions", opening the device's maps app (see directionsUrl) in a new
 * tab, so the prices are still here to come back to. A link, not a button:
 * it goes somewhere, and can be long-pressed or copied like any link.
 *
 * Its name starts with the visible word (WCAG 2.5.3) and says where it goes
 * and that it opens a new tab: "Directions to Metro Gosford, opens in a new
 * tab". The arrow is the usual visual cue for the new tab.
 */
export function DirectionsLink({
  station,
}: {
  station: Pick<StationPrice, 'name' | 'latitude' | 'longitude'>;
}) {
  return (
    <a
      className={styles.link}
      href={directionsUrl(station)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* The space outside the hidden text: some name calculations trim it from inside. */}
      Directions <VisuallyHidden>to {station.name}, opens in a new tab</VisuallyHidden>
      <span aria-hidden="true" className={styles.icon}>
        ↗
      </span>
    </a>
  );
}
