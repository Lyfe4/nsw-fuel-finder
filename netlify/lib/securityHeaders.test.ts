// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * The security headers live in netlify.toml and the page they protect in
 * index.html; nothing joins the two but these tests. A real browser checks
 * the whole policy against the live site (`pnpm check:browser` fails on any
 * CSP violation); these catch the cheap mistakes before a deploy.
 */

const toml = readFileSync('netlify.toml', 'utf8');
const html = readFileSync('index.html', 'utf8');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');

function header(name: string): string {
  const value = new RegExp(`^\\s*${name} = "(.*)"$`, 'm').exec(toml)?.[1];
  if (!value) throw new Error(`netlify.toml sets no ${name}`);
  return value;
}

const csp = new Map(
  header('Content-Security-Policy')
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .map(([name = '', ...sources]) => [name, sources]),
);

const sha256 = (text: string) =>
  `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

describe('security headers', () => {
  it('allows the first-paint theme script by its exact hash', () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1] ?? '',
    );
    expect(inline).toHaveLength(1);
    expect(csp.get('script-src')).toContain(sha256(inline[0] ?? ''));
  });

  it('never allows inline or evaluated script', () => {
    const scripts = csp.get('script-src') ?? [];
    expect(scripts).toContain("'self'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.filter((source) => !source.startsWith("'sha256-"))).toEqual(["'self'"]);
    // The theme script's, and no stale one left behind (the old badge's).
    expect(scripts.filter((source) => source.startsWith("'sha256-"))).toHaveLength(1);
  });

  it('contacts no other site on load: OpenFreeMap only once a map is shown', () => {
    const external = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="(https?:[^"]+)"/g)];
    expect(external.map((match) => match[1])).toEqual([]);
  });

  it('allows no inline styles', () => {
    expect(csp.get('style-src')).toEqual(["'self'"]);
  });

  it('lets the map reach OpenFreeMap, and nothing else outside this site', () => {
    for (const directive of ['connect-src', 'img-src']) {
      const external = (csp.get(directive) ?? []).filter((source) => source.startsWith('https:'));
      expect(external, directive).toEqual(['https://tiles.openfreemap.org']);
    }
    expect(csp.get('worker-src')).toEqual(["'self'"]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });

  it('refuses framing, plugins and a moved base', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('frame-src')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(header('X-Frame-Options')).toBe('DENY');
  });

  it('allows location for this site only, and sends other sites only the origin', () => {
    expect(header('Permissions-Policy')).toMatch(/(^|, )geolocation=\(self\)(,|$)/);
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/);
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('colours written outside the token file', () => {
  const palette = (name: string) =>
    new RegExp(`--palette-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)?.[1];

  it('the first-paint theme colour matches the page background in each theme', () => {
    expect(html).toContain(
      `theme === 'dark' ? '${palette('night-950') ?? ''}' : '${palette('counter') ?? ''}'`,
    );
  });

  it('the privacy page the footer links to exists, and runs no script', () => {
    const page = readFileSync('public/privacy.html', 'utf8');
    expect(readFileSync('src/app/App.tsx', 'utf8')).toContain('href="/privacy.html"');
    expect(page).toContain('<h1>Privacy</h1>');
    expect(page).not.toMatch(/<script|style="/);
  });

  it('the static pages (404, privacy) use the tokens’ colours', () => {
    const css = readFileSync('public/static-page.css', 'utf8');
    for (const name of ['counter', 'ink', 'ink-600', 'night-950', 'night-50', 'night-400']) {
      expect(css, name).toContain(palette(name) ?? 'missing');
    }
  });
});
