import { buildPlaceIndex } from './places';
import { SnapshotUnavailableError, type LoadedSnapshot } from './snapshotSource';
import { QLD_SERVE_MAX_MS, SNAPSHOT_VERSION } from '../../lib/snapshot/format';

import type { SourceId } from '../../../shared/api';

interface Source {
  get(): Promise<LoadedSnapshot>;
}

/**
 * WHAT THE ROUTES SEARCH: NSW's snapshot, and Queensland's when the request
 * may have it (round 15, docs/qld-plan.md, "The API reads two snapshots";
 * the gate is in router.ts and deps.ts).
 *
 * - Without Queensland: NSW's snapshot, as it always was. Queensland's is
 *   never read (qldExposure.test.ts).
 * - With it: both are read independently, each with its own cache and
 *   recheck (snapshotSource.ts), and merged in memory. Either can be missing
 *   or unreadable and the other is still served, with the missing one listed
 *   in `unavailable`; only when neither can be read is it a 503. So a QLD
 *   outage never breaks NSW's answers, nor the reverse.
 * - A Queensland snapshot older than QLD_SERVE_MAX_MS counts as unavailable
 *   (licence clause 2.3: prices current within 30 minutes), so a stopped
 *   job takes Queensland out of every answer on every deploy by itself.
 *
 * The merge (and its place index) is rebuilt only when what is merged
 * changes, about every 10 minutes, not per request. Station codes cannot
 * collide: Queensland's start with `qld-`.
 */
export function createCombinedSource(deps: { nsw: Source; qld: Source; now: () => number }) {
  let merged: { key: string; value: LoadedSnapshot } | null = null;

  async function both(): Promise<LoadedSnapshot> {
    const [nsw, qld] = await Promise.allSettled([deps.nsw.get(), deps.qld.get()]);
    const parts: { id: SourceId; loaded: LoadedSnapshot }[] = [];
    const unavailable: SourceId[] = [];
    for (const [id, result] of [
      ['nsw', nsw],
      ['qld', qld],
    ] as const) {
      if (result.status === 'rejected') {
        console.error(`The ${id.toUpperCase()} snapshot is unavailable`, result.reason);
        unavailable.push(id);
      } else if (
        id === 'qld' &&
        deps.now() - Date.parse(result.value.snapshot.fetchedAt) > QLD_SERVE_MAX_MS
      ) {
        console.error(
          `The QLD snapshot from ${result.value.snapshot.fetchedAt} is too old to serve`,
        );
        unavailable.push(id);
      } else {
        parts.push({ id, loaded: result.value });
      }
    }
    const [first] = parts;
    if (!first) {
      throw nsw.status === 'rejected' && nsw.reason instanceof SnapshotUnavailableError
        ? nsw.reason
        : new SnapshotUnavailableError('No price snapshot could be read.');
    }

    const sources = parts.map(({ id, loaded }) => ({ id, fetchedAt: loaded.snapshot.fetchedAt }));
    const key = sources.map((s) => `${s.id}@${s.fetchedAt}`).join('|');
    if (merged?.key === key) return { ...merged.value, unavailable };

    const stations = parts.flatMap(({ loaded }) => loaded.snapshot.stations);
    // The oldest of them: "prices as of" never claims more than every source has.
    const fetchedAt = sources.map((s) => s.fetchedAt).sort()[0] ?? first.loaded.snapshot.fetchedAt;
    const value: LoadedSnapshot = {
      snapshot: { version: SNAPSHOT_VERSION, fetchedAt, stations },
      // One source alone already has its index; two need one over both.
      places: parts.length === 1 ? first.loaded.places : buildPlaceIndex(stations),
      sources,
    };
    merged = { key, value };
    return { ...value, unavailable };
  }

  return {
    async get(withQld: boolean): Promise<LoadedSnapshot> {
      if (!withQld) {
        const loaded = await deps.nsw.get();
        return { ...loaded, sources: [{ id: 'nsw', fetchedAt: loaded.snapshot.fetchedAt }] };
      }
      return both();
    },
  };
}
