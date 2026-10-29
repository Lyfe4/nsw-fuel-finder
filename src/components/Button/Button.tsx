import { Icon } from '@/components/Icon/Icon';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

import styles from './Button.module.css';

import type { TablerIcon } from '@tabler/icons-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
  /** React 19 passes refs as an ordinary prop; it reaches the <button>. */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A native button with our styles. `type` defaults to "button": a button
 * inside a form that submits it should say so.
 */
export function Button({
  variant = 'secondary',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'title'> {
  icon: TablerIcon;
  /** The accessible name, visually hidden: "Close, Metro Gosford". */
  label: ReactNode;
  /** The pointer's tooltip, a word or two: "Close". The name says more. */
  title: string;
}

/**
 * Only for an icon everyone reads the same way (close, clear, zoom, search):
 * anything less certain keeps a word beside its icon. A full 44 px square,
 * the name in visually hidden text (so it is translated with the page),
 * and a tooltip for a pointer.
 */
export function IconButton({ icon, label, className, ...props }: IconButtonProps) {
  return (
    <Button className={[styles.iconOnly, className].filter(Boolean).join(' ')} {...props}>
      <Icon icon={icon} />
      <VisuallyHidden>{label}</VisuallyHidden>
    </Button>
  );
}
