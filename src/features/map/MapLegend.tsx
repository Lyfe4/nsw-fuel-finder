import styles from './MapLegend.module.css';

const swatch = (modifier: string | undefined) =>
  [styles.swatch, modifier].filter(Boolean).join(' ');

/**
 * What the dot colours mean. The colours are relative to the stations shown,
 * which the wording says, and they are never the only cue: prices are beside
 * the dots where they fit, the cheapest say "Cheapest", and the list has
 * every station in price order. Blue to grey to orange stays readable with
 * every common colour blindness (src/styles/tokens.test.ts checks it).
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
