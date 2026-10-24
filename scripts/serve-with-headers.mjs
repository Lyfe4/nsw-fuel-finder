/**
 * The built site, served locally with netlify.toml's real security headers,
 * so a change to the Content-Security-Policy can be tested before it reaches
 * production, where a mistake could silently blank the map:
 *
 *   pnpm build && pnpm serve:headers
 *   pnpm check:browser http://localhost:4174      # fails on any CSP violation
 *
 * /api/* is proxied to production, so the map and history have real data.
 * Reads only: the proxied API calls make no API.NSW calls and write nothing.
 * Unmatched paths get public/404.html with a 404, as on Netlify. No
 * compression or caching, so not a performance test.
 *
 * `--with-badge` adds Netlify's old free-plan badge the way Netlify used to
 * (and proxies its loader, /.netlify/*), to check that check:browser flags
 * it if Netlify ever starts serving it again: the policy no longer allows it.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const PROD = 'https://nsw-fuel-finder.netlify.app';
const toml = readFileSync('netlify.toml', 'utf8');
const headers = {};
const block = /for = "\/\*"\s*\[headers\.values\]([\s\S]*?)(?:\n\s*\n|\[\[)/.exec(toml)?.[1] ?? '';
for (const m of block.matchAll(/^\s*([\w-]+) = "(.*)"$/gm)) headers[m[1]] = m[2];
console.log('headers', Object.keys(headers));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};
const withBadge = process.argv.includes('--with-badge');
const BADGE = `<script async src="/.netlify/scripts/hud?variant=public" data-nf-variant="public" data-netlify-site-id="160725a2-0eff-4352-b586-5f6ad2fad975" data-app-host="app.netlify.com" data-account-tier="free"></script>`;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/') || (withBadge && url.pathname.startsWith('/.netlify/'))) {
    const upstream = await fetch(PROD + url.pathname + url.search);
    res.statusCode = upstream.status;
    res.setHeader('content-type', upstream.headers.get('content-type') ?? 'text/plain');
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  let file = join('dist', url.pathname === '/' ? 'index.html' : url.pathname);
  let status = 200;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join('dist', '404.html');
    status = 404;
  }
  res.statusCode = status;
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  let body = readFileSync(file);
  if (withBadge && file.endsWith('index.html'))
    body = Buffer.from(body.toString().replace('</html>', `</html>\n${BADGE}`));
  res.end(body);
}).listen(4174, () => console.log('serving on http://localhost:4174'));
