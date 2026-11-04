/*
 * The theme for the static pages (privacy.html, 404.html), before they paint.
 * The same decision as index.html's inline first-paint script: the stored
 * choice ("system" follows the device), or light for a visitor who never
 * chose (round 17). A file, not inline, so the Content-Security-Policy's
 * 'self' allows it with no hash of its own. Without it (blocked, missing),
 * the pages are light, the default. src/features/theme/theme.test.ts runs
 * both scripts against the same cases to hold them together.
 */
(function () {
  var theme;
  try {
    theme = window.localStorage.getItem('fuel-finder:theme:v1');
  } catch {
    theme = null;
  }
  if (theme === 'system') {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = dark ? 'dark' : 'light';
  }
  if (theme !== 'dark') theme = 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
