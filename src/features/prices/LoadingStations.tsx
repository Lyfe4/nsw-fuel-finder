import styles from './LoadingStations.module.css';

const PLACEHOLDERS = 6;

/**
 * Station-shaped rows while prices load (a name, a leader, a price; a
 * shorter line under it), so the page keeps its shape
 * and the list arrives where the eye already is. Hidden from screen readers:
 * the results status region already says "Loading prices…".
 */
export function LoadingStations() {
  return (
    <ul className={styles.list} aria-hidden="true" data-testid="loading-stations">
      {Array.from({ length: PLACEHOLDERS }, (_, index) => (
        <li key={index} className={styles.row}>
          <span className={styles.name} />
          <span className={styles.price} />
          <span className={styles.meta} />
        </li>
      ))}
    </ul>
  );
}
