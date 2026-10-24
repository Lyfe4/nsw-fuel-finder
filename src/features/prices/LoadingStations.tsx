import styles from './LoadingStations.module.css';

const PLACEHOLDERS = 3;

/**
 * Grey station-shaped cards while prices load, so the page keeps its shape
 * and the list arrives where the eye already is. Hidden from screen readers:
 * the results status region already says "Loading prices…".
 */
export function LoadingStations() {
  return (
    <ul className={styles.list} aria-hidden="true" data-testid="loading-stations">
      {Array.from({ length: PLACEHOLDERS }, (_, index) => (
        <li key={index} className={styles.card}>
          <span className={styles.price} />
          <span className={styles.line} />
          <span className={styles.lineShort} />
          <span className={styles.lineShort} />
        </li>
      ))}
    </ul>
  );
}
