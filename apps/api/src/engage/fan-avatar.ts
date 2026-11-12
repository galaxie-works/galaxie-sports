/**
 * Foto de perfil na moderação de imagem da Cosmos (#1025).
 *
 * - Foto nova (ou gravada antes do #1025): fica `pending` e só o próprio torcedor vê. O pedido de token não espera a
 *   moderação: ela roda depois da resposta.
 * - A Cosmos liberou: `visible`. Fora da régua, sem saldo, função desligada ("Moderar imagens", D10) ou imagem que não
 *   deu para ler: `held`, com caso na fila humana. A foto volta ao ar quando a equipe arquiva o caso sem ação.
 * - A decisão vale para o conteúdo, não para a URL: guardamos o hash da imagem moderada. A mesma URL é conferida de
 *   novo a cada `AVATAR_LIMITS.recheckMs` (a imagem atrás de um caminho fixo pode mudar), e uma URL nova com a mesma
 *   imagem (link assinado, `?v=`) herda a decisão anterior sem nova cobrança.
 * - A foto é buscada pela URL que o servidor do cliente mandou, com a proteção contra SSRF (`@galaxie/net-guard`), e
 *   não é guardada: o caso leva só a referência (`avatar_ref`) e a equipe abre a URL do Perfil.
 * - `pending` que não recebeu decisão (o processo caiu, a fila não aceitou o caso, muitas conferências ao mesmo tempo)
 *   tenta de novo no próximo pedido de token, depois de `AVATAR_LIMITS.retryMs`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { IMAGE_LIMITS, moderateImage, type ImageModerationOutcome } from '@galaxie/cosmos';
import {
  closeCase,
  fanProfile,
  moderationCase,
  type Database,
  type FanAvatarStatus,
  type ModerationClocks,
} from '@galaxie/db';
import { guardedFetch, type GuardedFetch } from '@galaxie/net-guard';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

export const AVATAR_LIMITS = {
  /** Tempo máximo para buscar a foto na URL do cliente. */
  fetchTimeoutMs: 10_000,
  /** `pending` sem decisão por mais que isso tenta de novo no próximo pedido de token. */
  retryMs: 10 * 60_000,
  /** A mesma URL já decidida é conferida de novo depois disso (a imagem atrás dela pode ter mudado). */
  recheckMs: 24 * 60 * 60_000,
  /** Conferências ao mesmo tempo neste processo; acima disso a foto fica pendente e tenta depois. */
  concurrency: 8,
} as const;

export interface AvatarBefore {
  avatarUrl: string | null;
  avatarStatus: FanAvatarStatus | null;
  avatarRef: string | null;
  avatarHash: string | null;
  avatarCheckedAt: Date | null;
}

/** A decisão anterior, que vale de novo se a imagem for a mesma (mesmo hash). */
export type AvatarPrevious = { ref: string; hash: string; status: 'visible' | 'held' } | null;

export interface AvatarPlan {
  /** Campos a gravar no Perfil; vazio = nada muda. */
  fields: {
    avatarStatus?: FanAvatarStatus | null;
    avatarRef?: string | null;
    avatarHash?: string | null;
    avatarCheckedAt?: Date | null;
  };
  /** A foto que precisa passar pela moderação depois da resposta; null = nenhuma. */
  check: { ref: string; url: string; previous: AvatarPrevious } | null;
}

const decided = (s: FanAvatarStatus | null | undefined): s is 'visible' | 'held' =>
  s === 'visible' || s === 'held';

/**
 * O que o pedido de token faz com a foto. Vai para a moderação: foto nova, foto de antes do #1025 (sem estado),
 * `pending` vencido e a mesma foto decidida há mais de `recheckMs`. Sem foto, o estado some junto.
 */
export function planAvatar(
  before: AvatarBefore | null | undefined,
  url: string | null,
  now: Date,
  newRef: () => string = randomUUID,
): AvatarPlan {
  if (url === null)
    return {
      fields: { avatarStatus: null, avatarRef: null, avatarHash: null, avatarCheckedAt: null },
      check: null,
    };
  const age = before?.avatarCheckedAt ? now.getTime() - before.avatarCheckedAt.getTime() : Infinity;
  if (before?.avatarUrl === url) {
    if (before.avatarStatus === 'pending' && age < AVATAR_LIMITS.retryMs) return { fields: {}, check: null };
    if (decided(before.avatarStatus) && age < AVATAR_LIMITS.recheckMs) return { fields: {}, check: null };
  }
  const previous: AvatarPrevious =
    before && decided(before.avatarStatus) && before.avatarRef && before.avatarHash
      ? { ref: before.avatarRef, hash: before.avatarHash, status: before.avatarStatus }
      : null;
  const ref = newRef();
  return {
    fields: { avatarStatus: 'pending', avatarRef: ref, avatarHash: null, avatarCheckedAt: now },
    check: { ref, url, previous },
  };
}

/** Lê a foto com teto de tamanho: acima dele, ou com erro, devolve vazio (a moderação manda para a fila). */
export async function fetchAvatar(fetcher: GuardedFetch, url: string): Promise<Uint8Array> {
  try {
    const res = await fetcher(url, {
      redirect: 'follow',
      headers: { accept: 'image/jpeg, image/png, image/webp' },
      signal: AbortSignal.timeout(AVATAR_LIMITS.fetchTimeoutMs),
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return new Uint8Array(0);
    }
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > IMAGE_LIMITS.maxBytes) {
      await res.body.cancel().catch(() => {});
      return new Uint8Array(0);
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_LIMITS.maxBytes) {
        await reader.cancel().catch(() => {});
        return new Uint8Array(0);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return new Uint8Array(0);
  }
}

export interface AvatarCheckInput {
  tenantId: string;
  profileId: string;
  ref: string;
  url: string;
  previous: AvatarPrevious;
  locale?: string;
  clocks: ModerationClocks;
}

export interface AvatarCheckDeps {
  fetch?: GuardedFetch;
  moderate?: (db: Database, input: Parameters<typeof moderateImage>[1]) => Promise<ImageModerationOutcome>;
  now?: () => Date;
}

/** O Perfil ainda está com esta foto (não trocou nem foi excluído no meio). */
async function stillCurrent(db: Database, input: AvatarCheckInput): Promise<boolean> {
  const [row] = await db
    .select({ id: fanProfile.id })
    .from(fanProfile)
    .where(
      and(
        eq(fanProfile.tenantId, input.tenantId),
        eq(fanProfile.id, input.profileId),
        eq(fanProfile.avatarRef, input.ref),
        eq(fanProfile.avatarStatus, 'pending'),
        isNull(fanProfile.deletedAt),
      ),
    );
  return !!row;
}

/** Grava a decisão se a foto ainda for a mesma; false quando ela mudou antes. */
async function decide(
  db: Database,
  input: AvatarCheckInput,
  set: { avatarStatus: FanAvatarStatus; avatarRef: string; avatarHash: string; avatarCheckedAt: Date },
): Promise<boolean> {
  const rows = await db
    .update(fanProfile)
    .set(set)
    .where(
      and(
        eq(fanProfile.tenantId, input.tenantId),
        eq(fanProfile.id, input.profileId),
        eq(fanProfile.avatarRef, input.ref),
        eq(fanProfile.avatarStatus, 'pending'),
        isNull(fanProfile.deletedAt),
      ),
    )
    .returning({ id: fanProfile.id });
  return rows.length > 0;
}

/**
 * Modera a foto e grava a decisão, se a foto ainda for a mesma (`avatar_ref`): uma foto trocada no meio, ou um Perfil
 * excluído, não recebe a decisão (e o caso que ficou para trás é fechado). Devolve o estado gravado; null = nada
 * gravado (a foto mudou, ou fica pendente para tentar depois).
 */
export async function checkAvatar(
  db: Database,
  input: AvatarCheckInput,
  deps: AvatarCheckDeps = {},
): Promise<FanAvatarStatus | null> {
  const now = deps.now ?? (() => new Date());
  if (!(await stillCurrent(db, input))) return null;
  const image = await fetchAvatar(deps.fetch ?? guardedFetch(), input.url);
  const hash = createHash('sha256').update(image).digest('hex');
  // a mesma imagem de antes (link assinado, `?v=`, conferência periódica): vale a decisão anterior, sem cobrar
  if (image.byteLength && input.previous && input.previous.hash === hash) {
    const ok = await decide(db, input, {
      avatarStatus: input.previous.status,
      avatarRef: input.previous.ref,
      avatarHash: hash,
      avatarCheckedAt: now(),
    });
    return ok ? input.previous.status : null;
  }
  // a busca pode levar segundos: a foto pode ter mudado ou o Perfil sido excluído nesse meio-tempo
  if (!(await stillCurrent(db, input))) return null;
  const outcome = await (deps.moderate ?? moderateImage)(db, {
    tenantId: input.tenantId,
    kind: 'profile_photo',
    image,
    ref: input.ref,
    targetType: 'profile',
    targetProfileId: input.profileId,
    module: 'profile',
    ...(input.locale ? { locale: input.locale } : {}),
    clocks: input.clocks,
  });
  // segurada sem caso na fila (nem a fila aceitou): fica pendente e tenta de novo depois, senão ninguém a liberaria
  if (!outcome.visible && !outcome.caseId) return null;
  const status: FanAvatarStatus = outcome.visible ? 'visible' : 'held';
  if (
    await decide(db, input, {
      avatarStatus: status,
      avatarRef: input.ref,
      avatarHash: hash,
      avatarCheckedAt: now(),
    })
  )
    return status;
  // a foto mudou (ou o Perfil foi excluído) durante a moderação: o caso desta foto não tem mais o que decidir
  if (outcome.caseId)
    await closeCase(db, {
      tenantId: input.tenantId,
      caseId: outcome.caseId,
      status: 'dismissed',
      actor: { id: 'system', kind: 'system' },
      reason: 'avatar.replaced',
      note: null,
      clocks: input.clocks,
    });
  return null;
}

/** Conferências em andamento neste processo (o teto evita buscas e chamadas pagas sem limite). */
let running = 0;

/**
 * Roda a conferência em segundo plano, respeitando `AVATAR_LIMITS.concurrency`. Lotado, não roda: a foto fica
 * pendente e tenta de novo no próximo pedido de token. Nunca lança.
 */
export function scheduleAvatarCheck(run: () => Promise<unknown>, onError: (err: unknown) => void): boolean {
  if (running >= AVATAR_LIMITS.concurrency) return false;
  running++;
  void Promise.resolve()
    .then(run)
    .catch(onError)
    .finally(() => {
      running--;
    });
  return true;
}

/**
 * A foto que os outros torcedores podem ver, por Perfil. Aparece quando o torcedor não escondeu a foto
 * (`visibility.avatar`), nenhum caso da foto a tirou do ar e: a Cosmos liberou (`visible`), ou a foto estava
 * segurada (`held`) e a equipe já fechou o caso sem esconder. Perfil sem foto liberada fica fora do mapa. O mural
 * (#946) e o chat usam isto para mostrar a foto de alguém.
 */
export async function publicAvatars(
  db: Database,
  tenantId: string,
  profileIds: readonly string[],
): Promise<Map<string, string>> {
  if (!profileIds.length) return new Map();
  const caseOf = (extra: ReturnType<typeof sql>) => sql`exists (
    select 1 from ${moderationCase}
    where ${moderationCase.tenantId} = ${fanProfile.tenantId}
      and ${moderationCase.targetType} = 'profile'
      and ${moderationCase.targetId} = ${fanProfile.avatarRef}
      and ${extra}
  )`;
  const rows = await db
    .select({ id: fanProfile.id, url: fanProfile.avatarUrl })
    .from(fanProfile)
    .where(
      and(
        eq(fanProfile.tenantId, tenantId),
        inArray(fanProfile.id, [...profileIds]),
        isNull(fanProfile.deletedAt),
        sql`coalesce(${fanProfile.visibility}->>'avatar', 'public') <> 'private'`,
        sql`not ${caseOf(sql`${moderationCase.hiddenAt} is not null`)}`,
        or(
          eq(fanProfile.avatarStatus, 'visible'),
          and(eq(fanProfile.avatarStatus, 'held'), caseOf(sql`${moderationCase.status} <> 'open'`)),
        ),
      ),
    );
  return new Map(rows.filter((r) => r.url !== null).map((r) => [r.id, r.url!]));
}
