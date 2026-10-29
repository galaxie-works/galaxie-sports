/** Onde assistir (épico #46): configuração, validador, versionamento, correção, auditoria e métricas. */
export * from './config/types.js';
export { Blocklist, CountryDirectory, WtwConfig, MAX_ALLOWED_DOMAINS } from './config/directory.js';
export {
  defaultConfigRoot,
  loadWtwConfig,
  parseBlocklistEnv,
  parseCountryConfig,
  parseLogos,
  parseOfficialLogos,
  WtwConfigError,
  type LoadWtwConfigOptions,
} from './config/loader.js';
export * from './normalize.js';
export * from './validator.js';
export * from './rights.js';
export * from './rights-research.js';
export * from './library.js';
export * from './official-logos.js';
export * from './store.js';
export * from './editorial.js';
export * from './match-channel.js';
export * from './logo-upload.js';
export * from './public.js';
export * from './audit.js';
export * from './metrics.js';
export * from './channel-list/index.js';
