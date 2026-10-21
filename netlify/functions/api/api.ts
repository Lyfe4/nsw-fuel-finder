/**
 * The Netlify function behind /api/*. It answers from the price snapshot in
 * Netlify Blobs and never calls API.NSW; netlify/functions/snapshot keeps the
 * snapshot fresh. See router.ts for the routes.
 *
 * The snapshot source lives at module scope, so a warm instance keeps its
 * parsed copy between requests.
 */
import { createHandler } from './router';
import { createSnapshotSource } from './snapshotSource';
import { blobStore } from '../../lib/store';

const now = () => Date.now();
const source = createSnapshotSource({ store: blobStore(), now });

export default createHandler({ getSnapshot: () => source.get(), now });
