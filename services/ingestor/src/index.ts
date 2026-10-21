/** Workers de ingestão (bootstrap, daily sync, live poller, asset mirror) e normalização raw → core. */
export const INGESTOR_JOBS = ['bootstrap', 'daily-sync', 'live-poller', 'asset-mirror', 'normalize'] as const;

export * from './normalize/upsert-core.js';
export * from './normalize/event-state.js';
export * from './normalize/raw-runner.js';
export * from './normalize/ingest.js';
export { uuidv7 } from './normalize/uuid.js';
