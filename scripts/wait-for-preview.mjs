/**
 * For CI's browser checks (.github/workflows/browser-checks.yml): which
 * Netlify deploy preview to test, once it is ready. Plain Node, no packages,
 * so the first step can run before anything is installed.
 *
 *   node scripts/wait-for-preview.mjs plan   # deployable=true|false
 *   node scripts/wait-for-preview.mjs wait   # url=https://...netlify.app
 *
 * Reads GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA; writes its
 * answer to GITHUB_OUTPUT and a line to the job summary. Read-only: the
 * token needs only pull-requests: read and statuses: read.
 *
 * plan: whether the pull request changes anything Netlify builds. The same
 * rule as `ignore` in netlify.toml: everything but docs/ and Markdown. A
 * pull request that changes neither never gets a preview, and passes.
 *
 * wait: polls Netlify's commit status on the head commit, which it posts as
 * "netlify/<site>/deploy-preview":
 *   - "Deploy Preview ready!": that deploy's own permalink, so a later push
 *     cannot swap the site under the checks;
 *   - "Deploy Preview canceled.": the ignore rule skipped this commit because
 *     nothing deployable changed since the pull request's last preview, so
 *     the checks run on that preview (deploy-preview-<n>), which serves it;
 *   - failure or error: the deploy failed, and so does this.
 */
import { appendFileSync } from 'node:fs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA } = process.env;
const TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS ?? 15 * 60_000);
const POLL_MS = 10_000;
const STATUS = /^netlify\/([a-z0-9-]+)\/deploy-preview$/;

for (const [name, value] of Object.entries({
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  HEAD_SHA,
})) {
  if (!value) throw new Error(`${name} is not set`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function output(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path}: ${String(response.status)}`);
  return response.json();
}

/** netlify.toml's `ignore`: a change outside docs/ that is not Markdown. */
const deployable = (path) => !path.startsWith('docs/') && !path.endsWith('.md');

async function plan() {
  const paths = [];
  // The API lists up to 3,000 files, 100 a page.
  for (let page = 1; page <= 30; page += 1) {
    const files = await github(`pulls/${PR_NUMBER}/files?per_page=100&page=${String(page)}`);
    for (const file of files) paths.push(file.filename, file.previous_filename ?? file.filename);
    if (files.length < 100) break;
  }
  const changed = paths.some(deployable);
  output('deployable', String(changed));
  if (!changed) {
    summary(
      'Only docs/ and Markdown changed, which Netlify does not build (netlify.toml `ignore`), so there is no deploy preview to check.',
    );
  }
}

/** Netlify's deploy-preview statuses on the head commit, newest first. */
async function netlifyStatuses() {
  // A commit has few statuses; the first page is plenty.
  const statuses = await github(`commits/${HEAD_SHA}/statuses?per_page=100`);
  return statuses.filter((status) => STATUS.test(status.context));
}

/** Netlify's own preview hosts only, so the URL is safe to hand to a shell. */
function previewUrl(url, site) {
  const host = new RegExp(`^https://[a-z0-9-]+--${site}\\.netlify\\.app$`);
  const clean = url.replace(/\/$/, '');
  if (!host.test(clean)) throw new Error(`Unexpected preview URL: ${url}`);
  return clean;
}

/** Waits until the preview answers, in case the CDN is a moment behind the status. */
async function reachable(url) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (response?.ok) return true;
    await sleep(5_000);
  }
  return false;
}

async function wait() {
  const started = Date.now();
  let seen = '';
  while (Date.now() - started < TIMEOUT_MS) {
    // A failed poll (GitHub having a moment) is tried again, not fatal.
    const statuses = await netlifyStatuses().catch((error) => {
      console.log(`Polling failed, trying again: ${String(error)}`);
      return null;
    });
    if (!statuses) {
      await sleep(POLL_MS);
      continue;
    }
    const [status] = statuses;
    const description = status?.description ?? 'no deploy preview status yet';
    if (description !== seen) {
      console.log(`${String(Math.round((Date.now() - started) / 1000))} s: ${description}`);
      seen = description;
    }
    const site = status ? STATUS.exec(status.context)?.[1] : undefined;
    if (status && site && status.state === 'success') {
      let url;
      if (/canceled/i.test(description)) {
        url = previewUrl(`https://deploy-preview-${PR_NUMBER}--${site}.netlify.app`, site);
        summary(
          `Netlify skipped this commit (nothing deployable changed since the last preview), so the checks run on the pull request's latest preview: ${url}`,
        );
      } else {
        // "Ready" links the pull request's alias, which a later push moves.
        // The deploy's own permalink is <deploy id>--<site>, the id from the
        // newest status that links the deploy log ("processing").
        const deployId = statuses
          .map((s) => /\/deploys\/([a-f0-9]+)/.exec(s.target_url ?? '')?.[1])
          .find(Boolean);
        url = previewUrl(
          deployId ? `https://${deployId}--${site}.netlify.app` : status.target_url,
          site,
        );
        summary(`Checks run on this commit's deploy preview: ${url}`);
      }
      if (!(await reachable(url))) throw new Error(`The preview does not answer: ${url}`);
      output('url', url);
      return;
    }
    if (status && (status.state === 'failure' || status.state === 'error')) {
      throw new Error(`Netlify: ${description} ${status.target_url ?? ''}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`No deploy preview after ${String(TIMEOUT_MS / 60_000)} minutes (${seen})`);
}

const mode = process.argv[2];
if (mode === 'plan') await plan();
else if (mode === 'wait') await wait();
else throw new Error('Usage: wait-for-preview.mjs plan|wait');
