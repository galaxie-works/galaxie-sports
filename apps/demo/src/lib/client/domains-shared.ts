/**
 * Parte pura dos domínios por TXT (`billing.domain`, #1136 F2): regras do host, nome do registro e tipos. Sem banco,
 * para o componente de cliente (`domains-panel.tsx`) importar sem puxar o Postgres para o navegador; o resto vive em
 * `domains.ts`, só no servidor.
 */
/** O mesmo CHECK de `billing.domain.host`: rótulos de 1 a 63 caracteres, minúsculas, dígitos e hífen, dois ou mais. */
export const DOMAIN_HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const DOMAIN_HOST_MAX = 253;
/** Domínios por marca (teto da tela; o banco não limita). */
export const MAX_DOMAINS = 20;
/** Prefixo do registro TXT que o cliente publica. */
export const DOMAIN_TXT_PREFIX = '_galaxie-verify';

/** Host como o banco aceita: minúsculas, sem esquema, caminho, porta nem ponto final; null se não serve. */
export function normalizeDomainHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  host = host
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!host || host.length > DOMAIN_HOST_MAX || !DOMAIN_HOST_RE.test(host)) return null;
  return host;
}

/** Nome do registro TXT a criar para o host. */
export const txtRecordName = (host: string) => `${DOMAIN_TXT_PREFIX}.${host}`;

export interface DomainRow {
  id: string;
  host: string;
  txtToken: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Conferência pedida e ainda na fila (pendente ou rodando). */
  checking: boolean;
}

export class DomainError extends Error {
  constructor(readonly code: 'invalid' | 'exists' | 'limit' | 'notFound' | 'taken') {
    super(code);
    this.name = 'DomainError';
  }
}
