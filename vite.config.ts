import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Absolute path to `src`, used for the `@/*` alias. Derived from this file's
// own URL so it works no matter where the process was started from.
const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],

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
