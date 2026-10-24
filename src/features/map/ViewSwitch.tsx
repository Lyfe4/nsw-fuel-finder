import { Button } from '@/components/Button/Button';

import styles from './ViewSwitch.module.css';

import type { ResultsLayout } from '../search/searchState';
import type { Ref } from 'react';

/**
 * List or Map, on a phone. Two toggle buttons (aria-pressed) in a labelled
 * group: each is an ordinary Tab stop, both stay on screen whichever is
 * chosen, so pressing one never loses focus. Tabs (role="tablist") were
 * considered; they promise arrow-key navigation and a tab panel, which is
 * more machinery than a two-way switch needs.
 */
export function ViewSwitch({
  view,
  onChange,
  mapButtonRef,
}: {
  view: ResultsLayout;
  onChange: (view: ResultsLayout) => void;
  mapButtonRef?: Ref<HTMLButtonElement>;
}) {
  const option = (value: ResultsLayout, text: string, ref?: Ref<HTMLButtonElement>) => (
    <Button
      {...(ref ? { ref } : {})}
      className={styles.option}
      aria-pressed={view === value}
      onClick={() => {
        onChange(value);
      }}
    >
      {text}
    </Button>
  );
  return (
    <div role="group" aria-label="Show results as" className={styles.switch}>
      {option('list', 'List')}
      {option('map', 'Map', mapButtonRef)}
    </div>
  );
}
