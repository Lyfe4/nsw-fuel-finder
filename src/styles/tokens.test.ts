import { describe, expect, it } from 'vitest';

import tokens from './tokens.css?raw';

/*
 * Guards for the token layer:
 * - CSS modules never write a colour of their own, so dark mode stays a
 *   token-only change;
 * - every text/background pair the UI uses meets WCAG AA.
 */

const modules = import.meta.glob<string>('../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function declarations(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) map.set(name, value.trim());
  }
  return map;
}

const declared = declarations(tokens);

function resolve(name: string, seen = new Set<string>()): string {
  const value = declared.get(name);
  if (value === undefined) throw new Error(`${name} is not defined in tokens.css`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!reference) return value;
  if (seen.has(reference)) throw new Error(`Circular token ${reference}`);
  return resolve(reference, seen.add(reference));
}

function luminance(hex: string): number {
  const channels = (hex.replace('#', '').match(/../g) ?? []).map((pair) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(resolve(foreground));
  const b = luminance(resolve(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('design tokens', () => {
  it('found the CSS modules to check', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(modules))('%s writes no colour of its own', (_, css) => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|--palette-/i);
  });

  it.each([
    ['--color-text', '--color-bg', 4.5],
    ['--color-text', '--color-surface', 4.5],
    ['--color-text-muted', '--color-surface', 4.5],
    ['--color-text-muted', '--color-bg', 4.5],
    ['--color-on-accent', '--color-accent', 4.5],
    ['--color-on-accent', '--color-accent-hover', 4.5],
    ['--color-accent', '--color-surface', 4.5],
    ['--color-text', '--color-highlight', 4.5],
    ['--color-text', '--color-accent-subtle', 4.5],
    ['--color-danger', '--color-danger-subtle', 4.5],
    ['--color-warning', '--color-warning-subtle', 4.5],
    // Non-text: the focus ring and control borders need 3:1 (WCAG 1.4.11).
    ['--color-focus', '--color-surface', 3],
    ['--color-focus', '--color-bg', 3],
    ['--color-border-strong', '--color-surface', 3],
  ])('%s on %s meets %d:1', (foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
