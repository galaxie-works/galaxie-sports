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
  featureFor,
  moderationPrompt,
  parseModerationResult,
  planModeration,
  summarize,
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
  /** `cosmos`: decidiu pelo modelo; `classifier`: pelo classificador; `fallback`: seguiu as regras e foi à fila. */
  by: 'cosmos' | 'classifier' | 'fallback';
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
  | 'overflow';

const RESERVE_FALLBACK: Record<string, FallbackReason> = {
  insufficient_credits: 'insufficient',
  wallet_blocked: 'blocked',
  cosmos_disabled: 'disabled',
  no_wallet: 'no_wallet',
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Escopo da configuração: a sala, a comunidade ou o cliente. */
export function scopeOf(item: Pick<ModerationItem, 'room' | 'community'>): ModerationScope {
  if (item.room) return { kind: 'room', id: item.room };
  if (item.community) return { kind: 'community', id: item.community };
  return { kind: 'tenant', id: '' };
}

/** Gravidade do caso na fila (0 a 100, a mesma escala das denúncias). */
const caseSeverity = (v: Verdict) => v.severity * 25;

/**
 * Modera um lote do mesmo cliente e do mesmo escopo (sala, comunidade ou cliente). Nunca lança por falta de saldo,
 * prazo ou modelo: o que não deu para decidir vai para a fila humana.
 */
export async function moderateBatch(
  db: Database,
  items: readonly ModerationItem[],
  deps: ModerationDeps = {},
): Promise<ModerationOutcome[]> {
  if (items.length === 0) return [];
  const first = items[0]!;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const [settings, ceiling] = await Promise.all([
    deps.settings ?? readCosmosSettings(db),
    deps.ceiling ?? readModerationCeiling(db),
  ]);
  const { effective: config } = await loadModerationConfig(db, first.tenantId, ceiling, scopeOf(first));

  const outcomes: ModerationOutcome[] = [];
  const toModel: ModerationItem[] = [];
  for (const item of items) {
    if (!config.features[featureFor(item.module)]) {
      outcomes.push({ item, by: 'fallback', verdict: null, plan: null, fallback: 'feature_off' });
      continue;
    }
    // com a Leitura total, o classificador decide o que é claro sem gastar
    if (config.features.full_read) {
      const c = classify(item.text, item.rules);
      if (c.outcome === 'violation' && c.verdict) {
        outcomes.push({
          item,
          by: 'classifier',
          verdict: c.verdict,
          plan: planModeration(c.verdict, config, ceiling, item.authorRole),
        });
        continue;
      }
    }
    toModel.push(item);
  }

  if (toModel.length > 0)
    outcomes.push(...(await askModel(db, toModel, config, ceiling, settings, env, deps)));

  for (const o of outcomes) {
    try {
      o.caseId = await apply(db, o, config, now());
    } catch (err) {
      // uma ação que falhou não derruba o lote: o item ainda vai para a fila humana
      console.error('[cosmos] ação da moderação falhou; item vai para a fila', {
        tenantId: o.item.tenantId,
        err,
      });
      Object.assign(o, { by: 'fallback', fallback: 'failed', verdict: null, plan: null });
      o.caseId = await apply(db, o, config, now()).catch(() => null);
    }
  }
  return outcomes;
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
        scope: `moderation.${items[0]!.module}`,
        ttlSeconds: MODERATION_RESERVATION_TTL_SECONDS,
      },
      { settings },
    );
  } catch (err) {
    if (isCosmosError(err)) return fallbackAll(RESERVE_FALLBACK[err.code] ?? 'unavailable');
    throw err;
  }

  const client =
    deps.client ??
    createCompletionClient(fn.provider, {
      apiKey: apiKey!,
      maxRetries: 0,
      timeoutMs: deps.timeoutMs ?? ENGINE_LIMITS.batchTimeoutMs,
    });
  let result;
  try {
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
  const usable = verdicts.some((v) => v !== null);
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
        maxCredits: reservation.credits,
        tokensIn: result.usage.inputTokens,
        tokensCached: result.usage.cachedInputTokens,
        tokensOut: result.usage.outputTokens,
        model: fn.model,
        // resposta fora do formato não vira cobrança: o custo vai para o extrato, sem débito
        ...(usable ? {} : { waive: true }),
        metadata: {
          kind: 'moderation',
          items: items.length,
          decided: verdicts.filter(Boolean).length,
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
  const share = Math.round((charged / items.length) * 1000) / 1000;
  return items.map((item, i) => {
    const verdict = verdicts[i];
    if (!verdict)
      return { item, by: 'fallback' as const, verdict: null, plan: null, fallback: 'unreadable' as const };
    const plan = planModeration(verdict, config, ceiling, item.authorRole);
    return { item, by: 'cosmos' as const, verdict: { ...verdict, credits: share }, plan };
  });
}

/** Aplica o resultado de um item: auditoria, fila, esconder e silenciar pela escada. Devolve o caso, se abriu. */
async function apply(
  db: Database,
  o: ModerationOutcome,
  config: ModerationConfig,
  at: Date,
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
  const content = item.text;

  // sem decisão da Cosmos: o texto segue as regras; o marcado pelas regras vai à fila humana (o denunciado já está)
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
    const { caseId } = await holdContent(db, {
      ...target,
      source: 'filter',
      reasons: item.rules.categories.length ? [...item.rules.categories] : [...item.rules.reasons],
      severity: item.rules.action === 'shadow' ? 75 : 25,
      hide: item.rules.action !== 'allow',
      content,
      detail: { kind: item.kind, fallback: o.fallback ?? null, summary: summarize(content) },
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
    reason: verdict.reason,
    level: plan.level,
    threshold: plan.threshold,
    steps: Object.fromEntries(plan.actions.map((a) => [a.action, a.step])),
    credits: verdict.credits ?? 0,
    summary: summarize(content),
  };

  if (plan.allow) {
    // denunciado: a sugestão da Cosmos vai para o caso, e quem decide é a equipe
    if (item.source === 'report') {
      const { caseId } = await holdContent(db, {
        ...target,
        source: 'cosmos',
        reasons: [],
        severity: 0,
        hide: false,
        content,
        detail: { ...detail, suggestion: 'allow' },
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
      reason: verdict.reason || null,
      rules: detail,
    });
    return null;
  }

  const hide = plan.actions.find((a) => a.action === 'hide');
  const { caseId } = await holdContent(db, {
    ...target,
    source: 'cosmos',
    reasons: [verdict.category],
    severity: caseSeverity(verdict),
    hide: hide !== undefined && hide.step !== 'flag',
    content,
    detail: { ...detail, suggestion: plan.actions.map((a) => a.action) },
    clocks: item.clocks,
    now: at,
  });

  const mute = plan.actions.find((a) => a.action === 'mute');
  const place = item.room ?? item.community;
  if (mute && mute.step !== 'flag' && item.targetProfileId && place) {
    const endsAt = new Date(at.getTime() + config.muteHours * 3600_000);
    const problems = checkSanction(
      { level: 'mute', hidden: false, decidedBy: 'cosmos', endsAt: endsAt.getTime(), scopeId: place },
      { now: at.getTime(), hiddenEnabled: false, policy: null },
    );
    if (problems.length === 0)
      await applySanction(db, {
        tenantId: item.tenantId,
        profileId: item.targetProfileId,
        accountId: null,
        level: 'mute',
        hidden: false,
        scope: 'place',
        scopeId: place,
        reason: verdict.reason || verdict.category,
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
      note: verdict.reason || null,
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
}

/**
 * Junta os itens por cliente e escopo e manda um lote por vez: quando enche (`batchItems`) ou quando passa a espera
 * (`batchWaitMs`). `submit` nunca espera nem lança. Com lotes demais esperando, o excedente vai para `overflow`
 * (fila humana) em vez de crescer a memória.
 */
export class ModerationBatcher {
  private readonly buckets = new Map<
    string,
    { items: ModerationItem[]; timer: ReturnType<typeof setTimeout> | null }
  >();
  private readonly ready: ModerationItem[][] = [];
  private pending = 0;
  private running = 0;
  private readonly idle = new Set<() => void>();

  constructor(
    private readonly handle: BatchHandler,
    private readonly overflow: BatchHandler,
    private readonly limits: BatcherLimits = ENGINE_LIMITS,
  ) {}

  submit(item: ModerationItem): void {
    if (this.pending >= this.limits.pendingMax) {
      void this.overflow([item]).catch((err) => console.error('[cosmos] fila da moderação cheia', err));
      return;
    }
    this.pending += 1;
    const scope = scopeOf(item);
    const key = `${item.tenantId}|${scope.kind}|${scope.id}`;
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

  /** Manda agora tudo que está juntando (desligamento do processo, testes). */
  async drain(): Promise<void> {
    for (const key of [...this.buckets.keys()]) this.flush(key);
    if (this.pending === 0) return;
    await new Promise<void>((resolve) => this.idle.add(resolve));
  }

  get size(): number {
    return this.pending;
  }

  private flush(key: string) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.items.length === 0) return;
    if (bucket.timer) clearTimeout(bucket.timer);
    this.buckets.delete(key);
    this.ready.push(bucket.items);
    this.pump();
  }

  private pump() {
    while (this.running < this.limits.concurrentBatches && this.ready.length > 0) {
      const batch = this.ready.shift()!;
      this.running += 1;
      void this.handle(batch)
        .catch((err) => {
          console.error('[cosmos] lote da moderação falhou', err);
          return this.overflow(batch).catch(() => {});
        })
        .finally(() => {
          this.running -= 1;
          this.pending -= batch.length;
          if (this.pending === 0) for (const done of this.idle) done();
          if (this.pending === 0) this.idle.clear();
          this.pump();
        });
    }
  }
}

/** Juntador ligado ao banco: cada lote vai por `moderateBatch`; o excedente vai direto para a fila humana. */
export function createModerationBatcher(db: Database, deps: ModerationDeps = {}): ModerationBatcher {
  return new ModerationBatcher(
    (items) => moderateBatch(db, items, deps),
    async (items) => {
      for (const item of items)
        await apply(
          db,
          { item, by: 'fallback', verdict: null, plan: null, fallback: 'overflow' },
          // sem configuração: o excedente só vai para a fila, não age
          {} as ModerationConfig,
          (deps.now ?? (() => new Date()))(),
        );
    },
  );
}
