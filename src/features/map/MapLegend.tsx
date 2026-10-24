import styles from './MapLegend.module.css';

const swatch = (modifier: string | undefined) =>
  [styles.swatch, modifier].filter(Boolean).join(' ');

/**
 * What the dot colours mean. The colours are relative to the stations shown,
 * which the wording says, and they are never the only cue: prices are beside
 * the dots where they fit and in the list.
 */
export function MapLegend() {
  return (
    <ul className={styles.legend} aria-label="Map key">
      <li>
        <span className={swatch(styles.low)} aria-hidden="true" /> Cheapest third
      </li>
      <li>
        <span className={swatch(styles.mid)} aria-hidden="true" /> Middle
      </li>
      <li>
        <span className={swatch(styles.high)} aria-hidden="true" /> Dearest third
      </li>
      <li>
        <span className={swatch(styles.origin)} aria-hidden="true" /> Search centre
      </li>
    </ul>
  );
}
