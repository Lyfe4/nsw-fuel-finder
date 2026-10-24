import { useId } from 'react';

import styles from './ThemeSelect.module.css';
import { useTheme } from './useTheme';

import type { ThemePreference } from './theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * A native select, for the same reasons as the fuel picker: three options,
 * a picker every phone already knows, and no ARIA to get wrong. A single
 * light/dark toggle was considered, but it has no way back to "follow the
 * device" once pressed.
 */
export function ThemeSelect() {
  const id = useId();
  const { preference, setPreference } = useTheme();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        Theme
      </label>
      <select
        id={id}
        className={styles.select}
        value={preference}
        onChange={(event) => {
          const chosen = OPTIONS.find((option) => option.value === event.target.value);
          if (chosen) setPreference(chosen.value);
        }}
      >
        {OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
