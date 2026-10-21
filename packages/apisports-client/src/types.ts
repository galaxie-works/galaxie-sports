import type { ApiSport } from './hosts.js';
import type { Params } from './request-hash.js';

/** Envelope padrão de todas as APIs da api-sports. */
export interface Envelope<T = unknown> {
  get: string;
  parameters: Record<string, string> | unknown[];
  /** `[]` (ou `{}`) no sucesso; objeto `{ plan: "...", rateLimit: "...", requests: "...", token: "..." }` no erro. */
  errors: unknown[] | Record<string, string>;
  results: number;
  paging?: { current: number; total: number };
  response: T;
}

export const PRIORITIES = ['BOOTSTRAP', 'DAILY', 'LIVE', 'ADHOC'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Desfecho de uma chamada enviada ao fornecedor (registrado no ledger). */
export type Outcome =
  'ok' | 'plan_error' | 'rate_limited' | 'quota_exhausted' | 'auth_error' | 'http_error' | 'timeout';

export interface CallRequest {
  sport: ApiSport;
  /** Ex.: "/fixtures", "/leagues". */
  endpoint: string;
  params?: Params;
  priority: Priority;
  jobId?: string;
  /** Sobrescreve o TTL do endpoint (ms). 0 força ida à rede. */
  maxAgeMs?: number;
  /** Só para LIVE: autoriza usar a reserva de segurança (decisões, finais). */
  critical?: boolean;
}

export interface CallResult<T = unknown> {
  envelope: Envelope<T>;
  /** `cache` = servido do raw sem gastar cota; `network` = chamada real. */
  source: 'cache' | 'network';
  requestHash: string;
  fetchedAt: Date;
  /** Header x-ratelimit-requests-remaining (eventualmente consistente). */
  quotaRemaining?: number | undefined;
}

export function hasErrors(envelope: Pick<Envelope, 'errors'>): boolean {
  const e = envelope.errors;
  if (Array.isArray(e)) return e.length > 0;
  return e != null && typeof e === 'object' && Object.keys(e).length > 0;
}

/** Classifica um envelope com erro no desfecho correspondente. */
export function classifyErrors(errors: Envelope['errors']): Outcome {
  if (Array.isArray(errors)) return errors.length ? 'http_error' : 'ok';
  const keys = Object.keys(errors ?? {});
  if (keys.length === 0) return 'ok';
  if (keys.includes('plan')) return 'plan_error';
  if (keys.includes('rateLimit')) return 'rate_limited';
  if (keys.includes('requests')) return 'quota_exhausted';
  if (keys.includes('token') || keys.includes('access')) return 'auth_error';
  return 'http_error';
}
