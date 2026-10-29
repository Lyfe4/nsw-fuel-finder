import { Icon } from '@/components/Icon/Icon';
import { NewTab } from '@/components/Icon/icons';
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
 * tab". The arrow after the word is the usual visual cue for the new tab.
 */
export function DirectionsLink({
  station,
  primary = false,
}: {
  station: Pick<StationPrice, 'name' | 'latitude' | 'longitude'>;
  /** Drawn as the primary button (the station card), not a text link. */
  primary?: boolean;
}) {
  return (
    <a
      className={primary ? styles.primary : styles.link}
      href={directionsUrl(station)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* The space outside the hidden text: some name calculations trim it from inside. */}
      Directions <VisuallyHidden>to {station.name}, opens in a new tab</VisuallyHidden>
      <Icon icon={NewTab} />
    </a>
  );
}
