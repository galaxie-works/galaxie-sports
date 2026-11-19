/**
 * O que a chave da demo (`GALAXIE_DEMO_KEY`) libera de fato na API (#1389). Os widgets da demo falam com a API como o
 * tenant dessa chave (o proxy `/api/galaxie` injeta a chave, e o token do torcedor também sai dela): é ele, e não o
 * tenant em foco no painel do cliente, que decide se um módulo responde ou devolve 403 `MODULE_NOT_IN_PLAN`.
 *
 * A resposta vem de `GET /v1/account` (não exige módulo): `key.effectiveModules` é a mesma lista que a API confere em
 * cada rota (direitos do tenant ∩ escopos da chave). Guardada por 60 s no processo (a demo roda num processo só, e a
 * API vê mudança de direitos em até 60 s); a falha fica 15 s, para a página não esperar a API a cada pedido.
 */
import { API_URL, apiHeaders } from './server';

export interface DemoKeyAccess {
  /** Tenant da chave da demo: o aviso para a equipe põe ele em foco antes de abrir Planos e módulos. */
  tenantId: string;
  /** Nome do tenant da chave da demo (aparece no aviso para a equipe). */
  tenantName: string;
  /** Módulos que a chave libera (`key.effectiveModules`). */
  modules: readonly string[];
}

const TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
/** A página não fica presa esperando a API: passou disso, conta como falha. */
const TIMEOUT_MS = 3_000;

let cached: { value: DemoKeyAccess | null; until: number } | null = null;
let pending: Promise<DemoKeyAccess | null> | null = null;

async function load(fetchImpl: typeof fetch): Promise<DemoKeyAccess | null> {
  if (!process.env.GALAXIE_DEMO_KEY) return null;
  try {
    const res = await fetchImpl(`${API_URL}/v1/account`, {
      headers: apiHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      tenant?: { id?: unknown; name?: unknown };
      key?: { effectiveModules?: unknown };
    };
    const modules = body.key?.effectiveModules;
    if (!Array.isArray(modules) || !modules.every((m) => typeof m === 'string')) return null;
    const { id, name } = body.tenant ?? {};
    if (typeof id !== 'string') return null;
    return { tenantId: id, tenantName: typeof name === 'string' ? name : '', modules };
  } catch {
    return null;
  }
}

/** Módulos da chave da demo; null quando a API não respondeu (sem chave, fora do ar ou resposta inesperada). */
export async function demoKeyAccess(
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoKeyAccess | null> {
  if (cached && cached.until > now()) return cached.value;
  // vários pedidos ao mesmo tempo esperam a mesma leitura
  pending ??= load(fetchImpl).then((value) => {
    cached = { value, until: now() + (value ? TTL_MS : FAILURE_TTL_MS) };
    pending = null;
    return value;
  });
  return pending;
}

/** Só para os testes. */
export function clearDemoKeyAccess() {
  cached = null;
  pending = null;
}
