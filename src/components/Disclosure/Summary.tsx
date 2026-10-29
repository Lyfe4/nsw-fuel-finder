import { Icon } from '@/components/Icon/Icon';
import { Disclosure } from '@/components/Icon/icons';

import styles from './Summary.module.css';

import type { ReactNode, Ref } from 'react';

/**
 * A <details>'s summary with the icon set's chevron in place of the
 * browser's own marker (a text triangle, which iOS can draw as an emoji):
 * pointing right when closed, down when open. The open state is still the
 * browser's to announce; the chevron is decoration.
 */
export function Summary({
  className,
  children,
  ref,
}: {
  className?: string | undefined;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <summary className={[styles.summary, className].filter(Boolean).join(' ')} ref={ref}>
      <span className={styles.line}>
        <Icon icon={Disclosure} className={styles.marker} />
        <span>{children}</span>
      </span>
    </summary>
  );
}
