import styles from './Icon.module.css';

import type { TablerIcon } from '@tabler/icons-react';

/**
 * An icon from `icons.ts`, as inline SVG in the text's colour
 * (currentColor), sized to the text around it. Always hidden from
 * assistive technology: the control it sits in carries the name, in words
 * on screen or visually hidden.
 */
export function Icon({
  icon: Glyph,
  className,
}: {
  icon: TablerIcon;
  className?: string | undefined;
}) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      className={[styles.icon, className].filter(Boolean).join(' ')}
    />
  );
}
