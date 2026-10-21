/** Workers de ingestão (bootstrap, daily sync, live poller, asset mirror) — implementados no épico Data Mirror. */
export const INGESTOR_JOBS = ['bootstrap', 'daily-sync', 'live-poller', 'asset-mirror'] as const;
