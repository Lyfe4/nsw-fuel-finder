/** The part of Netlify's per-invocation context the scheduled jobs read. */
export interface InvocationContext {
  deploy?: { context?: string };
}

/**
 * Only production (and `netlify dev`, whose store is local) runs a scheduled
 * job. The Blobs store is site-wide, so a deploy preview shares production's:
 * a "Run now" on a preview's function in the Netlify UI would otherwise
 * overwrite production's run record from a deploy without credentials. An
 * unknown or missing context runs, so a change on Netlify's side can never
 * silently stop production's snapshots.
 */
export function runsIn(context: InvocationContext | undefined): boolean {
  const deploy = context?.deploy?.context;
  return deploy !== 'deploy-preview' && deploy !== 'branch-deploy';
}
