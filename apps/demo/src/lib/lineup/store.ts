/**
 * Grades e ofertas das operadoras no banco (só no servidor): planos, canais de cada plano, streamings
 * inclusos, os pedidos de revisão das operadoras e a operadora ligada a cada tenant, pelas funções de
 * `@galaxie/db/lineups`. Toda a demo passa por aqui (os testes trocam este módulo), como o Builder passa
 * por `lib/builder/store.ts`.
 */
export {
  createLineupReviewRequest,
  createManualLineupItem,
  proposeManualLineupEdit,
  revertCustomLogo,
  dismissLineupChange,
  getPlatformLineup,
  getTenantOperator,
  listLineupReviewRequests,
  listPlatforms,
  resolveLineupReviewRequest,
  setLineupReviewStatus,
  setTenantOperator,
  LineupError,
  type LineupReviewRequest,
  type LineupTarget,
  type PlatformLineup,
  type TenantOperator,
} from '@galaxie/db/lineups';

export { uploadLogo, LogoUploadError } from '@galaxie/where-to-watch/logo-upload';
export { logoObjectStore, logoStorageConfigured } from './object-store';

export { builderDb as lineupDb } from '@/lib/builder/store';
