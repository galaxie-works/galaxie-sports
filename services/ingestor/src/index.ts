/** Workers de ingestão (bootstrap, daily sync, live poller, asset mirror) e normalização raw → core. */
export const INGESTOR_JOBS = ['bootstrap', 'daily-sync', 'live-poller', 'asset-mirror', 'normalize'] as const;

export * from './normalize/upsert-core.js';
export * from './normalize/event-state.js';
export * from './normalize/raw-runner.js';
export * from './normalize/ingest.js';
export { uuidv7 } from './normalize/uuid.js';
/** Workers de ingestão (bootstrap, daily sync, live poller, asset mirror) — implementados no épico Data Mirror. */
export const INGESTOR_JOBS = ['bootstrap', 'daily-sync', 'live-poller', 'asset-mirror'] as const;

export * from './context.js';
export * from './jobs/runtime/cursor-store.js';
export * from './jobs/runtime/job-run-store.js';
export * from './jobs/runtime/raw-source.js';
export * from './jobs/runtime/runner.js';
export * from './jobs/catalog-source.js';
export * from './jobs/fixtures.js';
export * from './jobs/teams.js';
export * from './jobs/seasons-job.js';
export * from './jobs/details-job.js';
export * from './jobs/people-job.js';
export * from './jobs/daily-job.js';
export * from './knowledge/derbies.js';
export * from './snapshot/raw-snapshot.js';
export { loadMediaDenylist, runAssetMirror, type MirrorReport } from './assets/asset-mirror.js';
export { InMemoryAssetStore, PgAssetStore, type AssetStore } from './assets/asset-store.js';
export { imageInfo } from './assets/image-info.js';
export { MediaFetcher, MEDIA_USER_AGENT } from './assets/media-fetcher.js';
export {
  InMemoryObjectStore,
  objectStoreFromEnv,
  S3ObjectStore,
  type ObjectStore,
} from './assets/object-store.js';
export { planSportCatalog, runSportCatalogJob } from './bootstrap/sport-catalog-job.js';
export { loadSportCatalog, type SportCatalogCompetition } from './catalog/catalog-config.js';
export { upsertCatalog } from './catalog/persist.js';
export { OTHER_SPORTS, SPORT_PROFILES, type OtherSport } from './catalog/sport-catalog.js';
