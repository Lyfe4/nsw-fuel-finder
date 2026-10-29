import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import type { Plugin } from 'vite';

// Absolute path to `src`, used for the `@/*` alias. Derived from this file's
// own URL so it works no matter where the process was started from.
const srcPath = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The site's own address, for the canonical link and the social-card tags,
 * which must be absolute. Netlify sets `URL` at build to the site's primary
 * domain, so moving to a custom domain is a setting in Netlify plus a
 * redeploy, with no code change. `SITE_URL` overrides it; anywhere else (a
 * laptop, CI) it is the netlify.app address.
 */
export const SITE_URL = (
  process.env.SITE_URL ??
  process.env.URL ??
  'https://nsw-fuel-finder.netlify.app'
).replace(/\/$/, '');

/** Fills %SITE_URL% in index.html. */
const siteUrl: Plugin = {
  name: 'site-url',
  transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
};

export default defineConfig({
  plugins: [react(), siteUrl],

  build: {
    // MapLibre's chunk is ~1 MB minified (~280 kB gzipped) and cannot be
    // split further. It is only fetched when a map is first shown (see
    // src/features/map/LazyStationMap.tsx), so it is warned about for nothing.
    chunkSizeWarningLimit: 1100,
    // The licences of every package in the bundle, MapLibre's BSD-3 and the
    // MIT ones among them, served beside the app at /third-party-notices.txt:
    // the minifier drops their comments, and their licences ask for the
    // notice to go with the code (round 16). Linked from the privacy note.
    license: { fileName: 'third-party-notices.txt' },
  },

  resolve: {
    // Mirror of the `paths` entry in tsconfig.app.json.
    alias: [{ find: '@', replacement: srcPath }],
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // No implicit globals: every test imports `describe`/`it`/`expect`
    // explicitly, which keeps the types honest.
    globals: false,
    // Process CSS Modules in tests so `styles.foo` is a real class name.
    css: true,
    // The Netlify functions' tests run here too. They declare `@vitest-environment
    // node` at the top of the file, so they get Node's real `fetch`,
    // `Request` and `Response` rather than jsdom's.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'shared/**/*.{test,spec}.ts',
      'netlify/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'netlify/**/*.ts'],
      exclude: ['**/*.{test,spec}.{ts,tsx}', '**/__fixtures__/**', 'src/main.tsx'],
    },
  },
});
