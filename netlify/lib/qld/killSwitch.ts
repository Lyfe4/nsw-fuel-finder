import { z } from 'zod';

import { QLD_KEYS, type KeyValueStore } from '../store';

/**
 * THE KILL SWITCH: `config/qld-enabled` in Blobs, the third of the three
 * things that must all hold for the API to serve Queensland (see
 * netlify/functions/api/deps.ts). Unlike QLD_PUBLIC, which a deploy keeps
 * from the moment it was built, every deploy reads this one store, so
 * turning it off stops Queensland on every deploy at once, old ones
 * included, without a redeploy.
 *
 * Written only by `pnpm qld:switch` (scripts/qld-switch.mjs), by the owner,
 * after typing a confirmation. Missing, unreadable or in an unknown shape
 * reads as OFF.
 */
export const qldSwitchSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  changedAt: z.string(),
});

/**
 * How long an API instance trusts its last read. Short, so "off" reaches
 * every warm instance within this, plus the CDN's minute or two.
 */
export const SWITCH_RECHECK_MS = 15_000;

export function createQldSwitch(deps: { store: KeyValueStore; now: () => number }) {
  let cached: { enabled: boolean; readAt: number } | null = null;
  let pending: Promise<boolean> | null = null;

  async function read(): Promise<boolean> {
    try {
      const parsed = qldSwitchSchema.safeParse(
        await deps.store.getJSON(QLD_KEYS.enabled, 'strong'),
      );
      if (!parsed.success) return false;
      return parsed.data.enabled;
    } catch (error) {
      console.error('Reading the QLD switch failed; treating it as off', error);
      return false;
    }
  }

  return {
    /** Whether the owner has Queensland switched on. Never throws. */
    isOn(): Promise<boolean> {
      if (cached && deps.now() - cached.readAt < SWITCH_RECHECK_MS) {
        return Promise.resolve(cached.enabled);
      }
      // Concurrent requests on one instance share one read.
      pending ??= read()
        .then((enabled) => {
          cached = { enabled, readAt: deps.now() };
          return enabled;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
