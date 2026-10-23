import styles from './VisuallyHidden.module.css';

import type { HTMLAttributes } from 'react';

/** Read by screen readers, invisible on screen. Not `display: none`, which hides it from both. */
export function VisuallyHidden({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={[styles.hidden, className].filter(Boolean).join(' ')} {...props} />;
}
