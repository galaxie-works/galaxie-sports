/** Workers de ingestão (bootstrap, daily sync, live poller, asset mirror) e normalização raw → core. */
export const INGESTOR_JOBS = ['bootstrap', 'daily-sync', 'live-poller', 'asset-mirror', 'normalize'] as const;

export * from './normalize/upsert-core.js';
export * from './normalize/event-state.js';
export * from './normalize/raw-runner.js';
export * from './normalize/ingest.js';
export * from './normalize/importance.js';
export * from './ops/change-feed-retention.js';
export { uuidv7 } from './normalize/uuid.js';

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

// ao vivo (docs/07 §2.1): Live Scheduler, Live Poller e processo de longa duração
export * from './live/types.js';
export * from './live/schedule.js';
export * from './live/diff.js';
export * from './live/store.js';
export * from './live/memory-store.js';
export * from './live/poller.js';
export * from './live/runner.js';
export * from './live/state.js';
export * from './standings/recompute.js';
export * from './normalize/after-fetch.js';
export { seedMultisport, todayUtc, type SeedStats as MultisportSeedStats } from './multisport/seed.js';
export { linkGamesCompetitions, type LinkReport as GamesLinkReport } from './multisport/competition-link.js';
