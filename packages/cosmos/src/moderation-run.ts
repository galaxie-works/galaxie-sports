/**
 * Motor de moderação da Cosmos (#998), parte com banco: `screenContent` (a entrada única para todos os módulos), o
 * juntador de lotes e `moderateBatch` (reserva, uma chamada por lote, acerto, ação pela escada, fila humana).
 *
 * A entrega ao torcedor nunca espera a Cosmos: `screenContent` devolve na hora o que as regras fixas decidiram, e a
 * Cosmos age depois (esconde, silencia, manda à fila). Regras de cobrança, as mesmas do assistente:
 * - Sem reserva, nenhuma chamada ao modelo. Sem saldo, função desligada ou modelo que não responde no prazo: o lote
 *   segue as regras e o classificador, e o que pedia a Cosmos vai para a fila humana. Nenhum módulo desliga.
 * - Um lançamento no extrato por lote, pelo custo real, nunca acima da reserva.
 */
import { createCompletionClient, type CompletionClient } from '@galaxie/llm';
import { estimateCostUsd } from '@galaxie/ai-ledger/pricing';
import type { Database } from '@galaxie/db/client';
import {
  activeSanctions,
  applySanction,
  closeCase,
  holdContent,
  recordModerationDecision,
  type ModerationClocks,
} from '@galaxie/db/moderation-queue';
import {
  checkSanction,
  screen,
  type CompiledLists,
  type ScreenKind,
  type ScreenResult,
  type TenantRole,
} from '@galaxie/engage';
import { creditsFor } from './credits.js';
import { isCosmosError } from './errors.js';
import { loadModerationConfig, type ModerationScope } from './moderation-config.js';
import {
  ENGINE_LIMITS,
  MODERATION_FUNCTION,
  classify,
  decisionReason,
  featureFor,
  isTruncated,
  moderationPrompt,
  parseModerationResult,
  planModeration,
  type ContentKind,
  type ContentModule,
  type ModerationPlan,
  type Verdict,
} from './moderation-engine.js';
import type { ModerationCeiling, ModerationConfig } from './moderation-rules.js';
import { cosmosApiKey } from './models.js';
import { readCosmosSettings, readModerationCeiling, type CosmosSettings } from './settings.js';
import { activeFunction, getWallet, release, reserve, settle } from './wallet.js';

/** Prazo da reserva do lote: maior que o tempo máximo da chamada. */
export const MODERATION_RESERVATION_TTL_SECONDS = 120;

/** Teto do texto no caso (o mesmo check do banco, `moderation_case_content`). */
const CASE_CONTENT_MAX = 10_000;

/** Alvo do texto na fila da base (B8). */
export type ModerationTargetType =
  'message' | 'comment' | 'post' | 'profile' | 'community_name' | 'league_name';

/** Um texto do torcedor a moderar. */
export interface ModerationItem {
  tenantId: string;
  kind: ContentKind;
  text: string;
  targetType: ModerationTargetType;
  targetId: string;
  /** Autor (Perfil do torcedor); sem ele, a Cosmos esconde mas não silencia. */
  targetProfileId: string | null;
  /** Cargo do autor na equipe do cliente, se for da equipe (cargo isento só é sinalizado). */
  authorRole?: TenantRole | null;
  module: ContentModule;
  room: string | null;
  community: string | null;
  locale?: string;
  /** `filter`: marcado pela Lista proibida ou pelo classificador; `report`: denunciado (já está na fila). */
  source: 'filter' | 'report';
  /** O que as regras fixas decidiram (B7). */
  rules: Pick<ScreenResult, 'action' | 'reasons' | 'categories' | 'suspect' | 'evasion'>;
  /** Relógios da ficha do país do torcedor (D5). */
  clocks: ModerationClocks;
}

export interface ModerationOutcome {
  item: ModerationItem;
  /**
   * `cosmos`: decidiu pelo modelo; `classifier`: pelo classificador; `fallback`: seguiu as regras (e o que as regras
   * marcaram foi à fila); `skipped`: nada a fazer (Leitura total não contratada, ou bloqueado sem lugar para silenciar).
   */
  by: 'cosmos' | 'classifier' | 'fallback' | 'skipped';
  verdict: Verdict | null;
  plan: ModerationPlan | null;
  /** Por que caiu (sem saldo, sem função, prazo...). */
  fallback?: FallbackReason;
  caseId?: string | null;
}

export type FallbackReason =
  | 'feature_off'
  | 'unavailable'
  | 'insufficient'
  | 'blocked'
  | 'disabled'
  | 'no_wallet'
  | 'failed'
  | 'unreadable'
  | 'truncated'
  | 'safety'
  | 'overflow'
  | 'not_contracted'
  | 'rules_decided';

const RESERVE_FALLBACK: Record<string, FallbackReason> = {
  insufficient_credits: 'insufficient',
  wallet_blocked: 'blocked',
  cosmos_disabled: 'disabled',
  no_wallet: 'no_wallet',
  safety_ceiling: 'safety',
};

export interface ModerationDeps {
  /** Cliente do modelo (testes); sem ele, o do provedor da função. */
  client?: CompletionClient;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  settings?: CosmosSettings;
  ceiling?: ModerationCeiling;
  settleBackoffMs?: number[];
  timeoutMs?: number;
  /**
   * Cada decisão, depois de gravada: o módulo tira do ar ao vivo o que a Cosmos escondeu (`plan.actions` com `hide`
   * fora de `flag`). Erro aqui não desfaz a decisão.
   */
  onDecision?: (outcome: ModerationOutcome) => void | Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Escopo da configuração: a sala, a comunidade ou o cliente. */
export function scopeOf(item: Pick<ModerationItem, 'room' | 'community'>): ModerationScope {
  if (item.room) return { kind: 'room', id: item.room };
  if (item.community) return { kind: 'community', id: item.community };
  return { kind: 'tenant', id: '' };
}

/**
 * Escopo da reserva e do extrato: a sala (`chat:<sala>`) ou a comunidade (`community:<id>`), o mesmo formato da cota
 * por sala (#1116); sem sala nem comunidade, o módulo (`moderation.<módulo>`), que não tem cota.
 */
export function reservationScope(item: Pick<ModerationItem, 'room' | 'community' | 'module'>): string {
  if (item.room) return `chat:${item.room}`;
  if (item.community) return `community:${item.community}`;
  return `moderation.${item.module}`;
}

/** Gravidade do caso na fila (0 a 100, a mesma escala das denúncias). */
const caseSeverity = (v: Verdict) => v.severity * 25;

/** Chave do lote: o mesmo cliente, o mesmo escopo e o mesmo módulo. */
const batchKey = (item: ModerationItem) => {
  const scope = scopeOf(item);
  return `${item.tenantId}|${scope.kind}|${scope.id}|${item.module}`;
};

/**
 * Modera um lote. Os itens são separados por cliente, escopo e módulo (cada grupo com a configuração, a reserva e o
 * extrato dele), e os resultados voltam na ordem da entrada. Nunca lança por falta de saldo, prazo ou modelo: o que
 * não deu para decidir segue as regras, e o que as regras marcaram vai para a fila humana.
 */
export async function moderateBatch(
  db: Database,
  items: readonly ModerationItem[],
  deps: ModerationDeps = {},
): Promise<ModerationOutcome[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = batchKey(item);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: ModerationOutcome[] = new Array(items.length);
  for (const idx of groups.values()) {
    const done = await moderateGroup(
      db,
      idx.map((i) => items[i]!),
      deps,
    );
    done.forEach((o, k) => (out[idx[k]!] = o));
  }
  return out;
}

async function moderateGroup(
  db: Database,
  items: ModerationItem[],
  deps: ModerationDeps,
): Promise<ModerationOutcome[]> {
  const first = items[0]!;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const [settings, ceiling] = await Promise.all([
    deps.settings ?? readCosmosSettings(db),
    deps.ceiling ?? readModerationCeiling(db),
  ]);
  const { effective: config } = await loadModerationConfig(db, first.tenantId, ceiling, scopeOf(first));

  const outcomes: (ModerationOutcome | null)[] = items.map(() => null);
  const toModel: number[] = [];
  items.forEach((item, i) => {
    const skip = (by: 'fallback' | 'skipped', fallback: FallbackReason) =>
      (outcomes[i] = { item, by, verdict: null, plan: null, fallback });
    if (!config.features[featureFor(item.module)]) return skip('fallback', 'feature_off');
    // a Leitura total é conferida aqui, não só no cache de quem chamou: sem ela, só vai ao modelo o que as regras
    // marcaram (ou foi denunciado)
    const marked = item.source === 'report' || item.rules.suspect || item.rules.action !== 'allow';
    if (!marked && !config.features.full_read) return skip('skipped', 'not_contracted');
    // bloqueado pelas regras e sem lugar (apelido, nome de liga): não publicou e não há onde silenciar
    if (item.source === 'filter' && item.rules.action === 'block' && !item.room && !item.community)
      return skip('skipped', 'rules_decided');
    // com a Leitura total, o classificador decide o que é claro sem gastar
    if (config.features.full_read) {
      const c = classify(item.text, item.rules);
      if (c.outcome === 'violation' && c.verdict) {
        outcomes[i] = {
          item,
          by: 'classifier',
          verdict: c.verdict,
          plan: planModeration(c.verdict, config, ceiling, item.authorRole),
        };
        return;
      }
      // limpo e sem marca das regras: não há dúvida para pagar
      if (c.outcome === 'clean' && !marked) return skip('skipped', 'not_contracted');
    }
    toModel.push(i);
  });

  if (toModel.length > 0) {
    const asked = await askModel(
      db,
      toModel.map((i) => items[i]!),
      config,
      ceiling,
      settings,
      env,
      deps,
    );
    asked.forEach((o, k) => (outcomes[toModel[k]!] = o));
  }

  const muted = new Set<string>();
  const result = outcomes as ModerationOutcome[];
  for (const o of result) {
    if (o.by === 'skipped') continue;
    try {
      o.caseId = await apply(db, o, config, now(), muted);
    } catch (err) {
      // uma ação que falhou não derruba o lote: o item ainda vai para a fila humana
      console.error('[cosmos] ação da moderação falhou; item vai para a fila', {
        tenantId: o.item.tenantId,
        targetId: o.item.targetId,
        err,
      });
      Object.assign(o, { by: 'fallback', fallback: 'failed', verdict: null, plan: null });
      o.caseId = await apply(db, o, config, now(), muted).catch((e) => {
        console.error('[cosmos] item da moderação perdido: nem a fila aceitou', {
          tenantId: o.item.tenantId,
          targetId: o.item.targetId,
          err: e,
        });
        return null;
      });
    }
    if (deps.onDecision)
      await Promise.resolve(deps.onDecision(o)).catch((err) =>
        console.error('[cosmos] aviso da decisão da moderação falhou', {
          tenantId: o.item.tenantId,
          targetId: o.item.targetId,
          err,
        }),
      );
  }
  return result;
}

async function askModel(
  db: Database,
  items: ModerationItem[],
  config: ModerationConfig,
  ceiling: ModerationCeiling,
  settings: CosmosSettings,
  env: Record<string, string | undefined>,
  deps: ModerationDeps,
): Promise<ModerationOutcome[]> {
  const tenantId = items[0]!.tenantId;
  const fallbackAll = (reason: FallbackReason) =>
    items.map((item) => ({ item, by: 'fallback' as const, verdict: null, plan: null, fallback: reason }));

  const fn = await activeFunction(db, MODERATION_FUNCTION);
  const apiKey = fn ? cosmosApiKey(fn.provider, env) : undefined;
  if (!fn || (!deps.client && !apiKey)) return fallbackAll('unavailable');

  const prompt = moderationPrompt(
    items.map((i) => ({ kind: i.kind, text: i.text })),
    items[0]!.locale,
  );
  const maxOutputTokens = items.length * ENGINE_LIMITS.outputTokensPerItem + 200;
  const wallet = await getWallet(db, tenantId);
  const estimate = creditsFor({
    costUsd: estimateCostUsd(fn.model, {
      inputTokens: Math.ceil((prompt.system.length + prompt.message.length) / 3),
      outputTokens: maxOutputTokens,
    }),
    multiplier: wallet?.multiplier ?? 1,
    creditUsd: settings.creditUsd,
    minCredits: fn.minCredits,
  });

  let reservation: { id: string; credits: number };
  try {
    reservation = await reserve(
      db,
      {
        tenantId,
        functionName: MODERATION_FUNCTION,
        estimatedCredits: estimate,
        scope: reservationScope(items[0]!),
        ttlSeconds: MODERATION_RESERVATION_TTL_SECONDS,
      },
      { settings },
    );
  } catch (err) {
    if (isCosmosError(err)) return fallbackAll(RESERVE_FALLBACK[err.code] ?? 'unavailable');
    throw err;
  }

  let result;
  try {
    const client =
      deps.client ??
      createCompletionClient(fn.provider, {
        apiKey: apiKey!,
        maxRetries: 0,
        timeoutMs: deps.timeoutMs ?? ENGINE_LIMITS.batchTimeoutMs,
      });
    result = await client.complete({
      model: fn.model,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.message }],
      maxOutputTokens,
      timeoutMs: deps.timeoutMs ?? ENGINE_LIMITS.batchTimeoutMs,
      signal: AbortSignal.timeout(deps.timeoutMs ?? ENGINE_LIMITS.batchTimeoutMs),
      purpose: `cosmos:moderation:${tenantId}`,
    });
  } catch (err) {
    await release(db, { tenantId, reservationId: reservation.id }).catch((e) =>
      console.error('[cosmos] reserva da moderação não voltou', e),
    );
    console.error('[cosmos] lote da moderação falhou; segue pelas regras e pela fila', { tenantId, err });
    return fallbackAll('failed');
  }

  const verdicts = parseModerationResult(result.text, items.length);
  const decided = verdicts.filter(Boolean).length;
  const usable = decided > 0;
  // resposta parcial: cobra só a parte decidida do lote (o resto vai pelas regras, sem custo para o cliente)
  const maxCredits =
    decided === items.length
      ? reservation.credits
      : Math.max(1, Math.ceil((reservation.credits * decided) / items.length));
  const costUsd = estimateCostUsd(fn.model, {
    inputTokens: result.usage.inputTokens,
    cachedInputTokens: result.usage.cachedInputTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    outputTokens: result.usage.outputTokens,
  });
  const backoff = deps.settleBackoffMs ?? [200, 800];
  let charged = 0;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
      const s = await settle(db, {
        tenantId,
        reservationId: reservation.id,
        costUsd,
        maxCredits,
        tokensIn: result.usage.inputTokens,
        tokensCached: result.usage.cachedInputTokens,
        tokensOut: result.usage.outputTokens,
        model: fn.model,
        // resposta fora do formato não vira cobrança: o custo vai para o extrato, sem débito
        ...(usable ? {} : { waive: true }),
        metadata: {
          kind: 'moderation',
          items: items.length,
          decided,
          module: items[0]!.module,
        },
      });
      charged = s.charged;
      break;
    } catch (err) {
      if (isCosmosError(err, 'reservation_closed') || attempt === backoff.length) {
        console.error('[cosmos] acerto da moderação falhou; fica para conciliação', {
          tenantId,
          reservationId: reservation.id,
          costUsd,
          err,
        });
        break;
      }
      await sleep(backoff[attempt]!);
    }
  }
  const share = decided > 0 ? Math.round((charged / decided) * 1000) / 1000 : 0;
  return items.map((item, i): ModerationOutcome => {
    const verdict = verdicts[i];
    if (!verdict) return { item, by: 'fallback', verdict: null, plan: null, fallback: 'unreadable' };
    const plan = planModeration(verdict, config, ceiling, item.authorRole);
    // o modelo não viu o meio do texto longo: "liberado" não vale, segue as regras
    if (plan.allow && isTruncated(item.text))
      return { item, by: 'fallback', verdict: null, plan: null, fallback: 'truncated' };
    return { item, by: 'cosmos', verdict: { ...verdict, credits: share }, plan };
  });
}

/**
 * Aplica o resultado de um item: auditoria, fila, esconder e silenciar pela escada. Devolve o caso, se abriu.
 * O texto do torcedor só vai para o caso (`content`, com o relógio da ficha e a exclusão); a auditoria e a punição
 * guardam categoria e gravidade, nunca palavras do texto.
 */
async function apply(
  db: Database,
  o: ModerationOutcome,
  config: Pick<ModerationConfig, 'muteHours'>,
  at: Date,
  muted: Set<string>,
): Promise<string | null> {
  const { item } = o;
  const target = {
    tenantId: item.tenantId,
    targetType: item.targetType,
    targetId: item.targetId,
    targetProfileId: item.targetProfileId,
    module: item.module,
    room: item.room,
    community: item.community,
  };
  const content = item.text.trim().slice(0, CASE_CONTENT_MAX) || null;

  // sem decisão da Cosmos: o texto segue as regras; o que as regras marcaram vai à fila humana (o denunciado já está)
  if (!o.verdict || !o.plan) {
    if (item.source === 'report') {
      await recordModerationDecision(db, {
        tenantId: item.tenantId,
        actor: { id: 'cosmos', kind: 'cosmos' },
        action: 'cosmos.skip',
        clocks: item.clocks,
        subjectProfileId: item.targetProfileId,
        reason: o.fallback ?? null,
        rules: { kind: item.kind, fallback: o.fallback ?? null },
      });
      return null;
    }
    // só dúvida do classificador (as regras deixaram publicar): continua publicado, sem encher a fila
    if (!item.rules.suspect && item.rules.action === 'allow') return null;
    const { caseId } = await holdContent(db, {
      ...target,
      source: 'filter',
      reasons: item.rules.categories.length ? [...item.rules.categories] : [...item.rules.reasons],
      severity: item.rules.action === 'shadow' ? 75 : 25,
      hide: item.rules.action !== 'allow',
      content,
      detail: { kind: item.kind, fallback: o.fallback ?? null },
      clocks: item.clocks,
      now: at,
    });
    return caseId;
  }

  const { verdict, plan } = o;
  const detail = {
    kind: item.kind,
    by: verdict.by,
    category: verdict.category,
    severity: verdict.severity,
    level: plan.level,
    threshold: plan.threshold,
    steps: Object.fromEntries(plan.actions.map((a) => [a.action, a.step])),
    credits: verdict.credits ?? 0,
  };
  const reason = decisionReason(verdict);

  if (plan.allow) {
    // denunciado, ou segurado pelas regras: a sugestão da Cosmos vai para o caso, e quem decide é a equipe
    if (item.source === 'report' || item.rules.action === 'shadow') {
      const { caseId } = await holdContent(db, {
        ...target,
        source: 'cosmos',
        reasons: [],
        severity: 0,
        // segurado pelas regras: continua fora do ar até a equipe decidir (publicar devolve)
        hide: item.rules.action !== 'allow',
        content,
        // o motivo do modelo fica só no caso (a exclusão do torcedor apaga)
        detail: { ...detail, reason: verdict.reason, suggestion: 'allow' },
        clocks: item.clocks,
        now: at,
      });
      return caseId;
    }
    await recordModerationDecision(db, {
      tenantId: item.tenantId,
      actor: { id: 'cosmos', kind: 'cosmos' },
      action: 'cosmos.allow',
      clocks: item.clocks,
      subjectProfileId: item.targetProfileId,
      reason,
      rules: detail,
    });
    return null;
  }

  const hide = plan.actions.find((a) => a.action === 'hide');
  const hidden = hide !== undefined && hide.step !== 'flag';
  const { caseId } = await holdContent(db, {
    ...target,
    source: 'cosmos',
    reasons: [verdict.category],
    severity: caseSeverity(verdict),
    hide: hidden,
    content,
    detail: { ...detail, reason: verdict.reason, suggestion: plan.actions.map((a) => a.action) },
    clocks: item.clocks,
    now: at,
  });
  if (hidden)
    await recordModerationDecision(db, {
      tenantId: item.tenantId,
      actor: { id: 'cosmos', kind: 'cosmos' },
      action: 'hide',
      clocks: item.clocks,
      subjectProfileId: item.targetProfileId,
      caseId,
      reason,
      rules: { by: verdict.by, category: verdict.category, severity: verdict.severity, step: hide.step },
    });

  const mute = plan.actions.find((a) => a.action === 'mute');
  const place = item.room ?? item.community;
  const muteKey = `${item.targetProfileId}|${place}`;
  if (mute && mute.step !== 'flag' && item.targetProfileId && place && !muted.has(muteKey)) {
    muted.add(muteKey);
    const endsAt = new Date(at.getTime() + config.muteHours * 3600_000);
    const problems = checkSanction(
      { level: 'mute', hidden: false, decidedBy: 'cosmos', endsAt: endsAt.getTime(), scopeId: place },
      { now: at.getTime(), hiddenEnabled: false, policy: null },
    );
    // já silenciado no lugar: não empilha outra punição pelas mensagens seguintes
    const already =
      problems.length === 0 &&
      (
        await activeSanctions(db, {
          tenantId: item.tenantId,
          profileId: item.targetProfileId,
          accountId: null,
          now: at,
        })
      ).some((s) => s.level === 'mute' && (s.scopeId === place || s.scope !== 'place'));
    if (problems.length === 0 && !already)
      await applySanction(db, {
        tenantId: item.tenantId,
        profileId: item.targetProfileId,
        accountId: null,
        level: 'mute',
        hidden: false,
        scope: 'place',
        scopeId: place,
        reason,
        caseId,
        actor: { id: 'cosmos', kind: 'cosmos' },
        endsAt,
        clocks: item.clocks,
        rules: { by: verdict.by, category: verdict.category, severity: verdict.severity, step: mute.step },
        now: at,
      });
  }

  // tudo em "age sozinha": o caso fecha resolvido pela Cosmos (continua no histórico e pode ser desfeito)
  if (!plan.queue)
    await closeCase(db, {
      tenantId: item.tenantId,
      caseId,
      status: 'resolved',
      actor: { id: 'cosmos', kind: 'cosmos' },
      note: reason,
      clocks: item.clocks,
      now: at,
    });
  return caseId;
}

// ---------------------------------------------------------------------------------------------------------------
// Entrada única e juntador de lotes

export interface ScreenContentInput {
  tenantId: string;
  kind: ContentKind;
  text: string;
  targetType: ModerationTargetType;
  targetId: string;
  targetProfileId: string | null;
  authorRole?: TenantRole | null;
  module: ContentModule;
  room?: string | null;
  community?: string | null;
  locale?: string;
  /** Modo lento da sala (B7). */
  rate?: { intervalS: number; lastSentAt: number | null; now: number };
  /** Leitura total contratada no escopo (o chamador lê da configuração em cache). */
  fullRead: boolean;
  clocks: ModerationClocks;
}

const RULE_KIND: Record<ContentKind, ScreenKind> = {
  chat_message: 'chat_message',
  wall_post: 'wall_post',
  poll_option: 'poll_option',
  nickname: 'nickname',
  community_name: 'community_name',
  league_name: 'league_name',
  // pergunta de trivia: o texto é livre como um post do mural
  trivia_question: 'wall_post',
};

/**
 * Entrada única do motor para todos os módulos (`screen(content, { kind, tenant, scope, locale, country })`): as
 * regras fixas decidem na hora o que publica, e o que pede a Cosmos vai para o lote, sem atrasar a entrega.
 * Sem a Leitura total, só o que a Lista proibida marcou vai adiante; com ela, o classificador separa o claro da dúvida.
 */
export function screenContent(
  input: ScreenContentInput,
  lists: CompiledLists,
  batcher: Pick<ModerationBatcher, 'submit'>,
): ScreenResult & { sentToCosmos: boolean } {
  const result = screen(
    input.text,
    {
      kind: RULE_KIND[input.kind],
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.rate ? { rate: input.rate } : {}),
    },
    lists,
  );
  // bloqueado por formato (vazio, longo demais, modo lento): não há o que a Cosmos olhar
  const formal = result.reasons.every((r) => r === 'empty' || r === 'too_long' || r === 'slow_mode');
  let send = result.suspect && !(result.action === 'block' && formal);
  if (!send && input.fullRead && result.action === 'allow')
    send = classify(input.text, result).outcome !== 'clean';
  if (send)
    batcher.submit({
      tenantId: input.tenantId,
      kind: input.kind,
      text: input.text,
      targetType: input.targetType,
      targetId: input.targetId,
      targetProfileId: input.targetProfileId,
      authorRole: input.authorRole ?? null,
      module: input.module,
      room: input.room ?? null,
      community: input.community ?? null,
      ...(input.locale ? { locale: input.locale } : {}),
      source: 'filter',
      rules: result,
      clocks: input.clocks,
    });
  return { ...result, sentToCosmos: send };
}

type BatchHandler = (items: ModerationItem[]) => Promise<unknown>;

export interface BatcherLimits {
  batchItems: number;
  batchWaitMs: number;
  concurrentBatches: number;
  pendingMax: number;
  /** Itens esperando de um mesmo cliente (um jogo grande não ocupa o lugar dos outros). Padrão: `pendingMax`. */
  tenantPendingMax?: number;
  /** Itens esperando a fila humana pelo excedente; acima disso, descartados com registro no log. */
  overflowMax?: number;
}

/**
 * Junta os itens por cliente, escopo e módulo e manda um lote por vez: quando enche (`batchItems`) ou quando passa a
 * espera (`batchWaitMs`). `submit` nunca espera nem lança. Com itens demais esperando (no processo ou do cliente), o
 * excedente vai para `overflow` (fila humana), um lote de cada vez, e a memória fica limitada.
 */
export class ModerationBatcher {
  private readonly buckets = new Map<
    string,
    { items: ModerationItem[]; timer: ReturnType<typeof setTimeout> | null }
  >();
  private readonly ready: { items: ModerationItem[]; done: () => void }[] = [];
  private readonly waiting = new Set<Promise<void>>();
  private readonly perTenant = new Map<string, number>();
  private readonly spill: ModerationItem[] = [];
  private spilling: Promise<void> | null = null;
  private pending = 0;
  private running = 0;

  constructor(
    private readonly handle: BatchHandler,
    private readonly overflow: BatchHandler,
    private readonly limits: BatcherLimits = ENGINE_LIMITS,
  ) {}

  submit(item: ModerationItem): void {
    const tenantPending = this.perTenant.get(item.tenantId) ?? 0;
    if (
      this.pending >= this.limits.pendingMax ||
      tenantPending >= (this.limits.tenantPendingMax ?? this.limits.pendingMax)
    ) {
      this.toOverflow(item);
      return;
    }
    this.pending += 1;
    this.perTenant.set(item.tenantId, tenantPending + 1);
    const key = batchKey(item);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { items: [], timer: null };
      this.buckets.set(key, bucket);
    }
    bucket.items.push(item);
    if (bucket.items.length >= this.limits.batchItems) this.flush(key);
    else if (!bucket.timer) {
      const timer = setTimeout(() => this.flush(key), this.limits.batchWaitMs);
      timer.unref?.();
      bucket.timer = timer;
    }
  }

  /** Manda agora tudo que está juntando e espera os lotes que existiam na hora (desligamento do processo, testes). */
  async drain(): Promise<void> {
    for (const key of [...this.buckets.keys()]) this.flush(key);
    await Promise.all([...this.waiting, this.spilling]);
  }

  /** Itens esperando: nos lotes e no excedente. */
  get size(): number {
    return this.pending + this.spill.length;
  }

  private toOverflow(item: ModerationItem) {
    if (this.spill.length >= (this.limits.overflowMax ?? this.limits.pendingMax)) {
      console.error('[cosmos] moderação sobrecarregada: item descartado sem ir à fila', {
        tenantId: item.tenantId,
        targetId: item.targetId,
      });
      return;
    }
    this.spill.push(item);
    if (!this.spilling) this.spilling = this.drainSpill().finally(() => (this.spilling = null));
  }

  /** O excedente vai à fila humana em série: lento no pior momento, mas sem abrir uma transação por mensagem. */
  private async drainSpill() {
    while (this.spill.length > 0) {
      const chunk = this.spill.splice(0, this.limits.batchItems);
      await this.overflow(chunk).catch((err) =>
        console.error('[cosmos] excedente da moderação não entrou na fila', {
          items: chunk.map((i) => ({ tenantId: i.tenantId, targetId: i.targetId })),
          err,
        }),
      );
    }
  }

  private flush(key: string) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.items.length === 0) return;
    if (bucket.timer) clearTimeout(bucket.timer);
    this.buckets.delete(key);
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    this.waiting.add(finished);
    void finished.then(() => this.waiting.delete(finished));
    this.ready.push({ items: bucket.items, done });
    this.pump();
  }

  private pump() {
    while (this.running < this.limits.concurrentBatches && this.ready.length > 0) {
      const batch = this.ready.shift()!;
      this.running += 1;
      void this.handle(batch.items)
        .catch((err) => {
          console.error('[cosmos] lote da moderação falhou; vai para a fila humana', err);
          return this.overflow(batch.items).catch((e) =>
            console.error('[cosmos] lote da moderação perdido: nem a fila aceitou', {
              items: batch.items.map((i) => ({ tenantId: i.tenantId, targetId: i.targetId })),
              err: e,
            }),
          );
        })
        .finally(() => {
          this.running -= 1;
          this.pending -= batch.items.length;
          for (const i of batch.items) {
            const n = (this.perTenant.get(i.tenantId) ?? 1) - 1;
            if (n > 0) this.perTenant.set(i.tenantId, n);
            else this.perTenant.delete(i.tenantId);
          }
          batch.done();
          this.pump();
        });
    }
  }
}

/** Juntador ligado ao banco: cada lote vai por `moderateBatch`; o excedente vai direto para a fila humana. */
export function createModerationBatcher(db: Database, deps: ModerationDeps = {}): ModerationBatcher {
  const now = deps.now ?? (() => new Date());
  return new ModerationBatcher(
    (items) => moderateBatch(db, items, deps),
    async (items) => {
      const muted = new Set<string>();
      for (const item of items)
        await apply(
          db,
          { item, by: 'fallback', verdict: null, plan: null, fallback: 'overflow' },
          // sem decisão, o excedente só vai para a fila (não silencia)
          { muteHours: 1 },
          now(),
          muted,
        );
    },
  );
}
