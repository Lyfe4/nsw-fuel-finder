import styles from './Button.module.css';

import type { ButtonHTMLAttributes, Ref } from 'react';

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
