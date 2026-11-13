/**
 * Leituras do painel de Operação (só no servidor). Fala direto com o schema `ops` do mesmo Postgres,
 * como o painel de usuários faz com `demo_auth`: a configuração da operação não é dado da API pública
 * e o painel precisa do histórico, da fila e do relatório de env de cada contêiner.
 *
 * Nenhum segredo sai daqui: os contêineres relatam credenciais só como "configurada ou não"
 * (ops.runtime_env.value fica nulo; na SETTINGS_KEK, só os ids das KEKs) e as da própria demo passam pelo mesmo
 * `envReportWithKek`.
 */
import {
  AI_CREDIT_CHECK,
  API_PLAN_DAILY_LIMITS,
  AI_CALL_BANDS,
  APISPORTS_APIS,
  DEFAULT_BUDGET_DAY,
  MIRROR_APIS,
  MIRROR_INVENTORY_CURSOR,
  parseMirrorInventory,
  SCHEDULED_JOBS,
  SETTINGS,
  bandLimitsUsd,
  budgetDayOf,
  isPanelSecret,
  isSecret,
  nextCronRuns,
  parseAgentStatus,
  parseAgentUsdBudgets,
  parseBandShares,
  planKey,
  reportedService,
  resolveAll,
  sealedBaseKey,
  sealedKey,
  settingDef,
  validateSettingKey,
  type RuntimeService,
  type SettingDef,
} from '@galaxie/runtime-config';
import {
  envReportWithKek,
  parseSettingsKekStatus,
  sealedKid,
  secretHint,
  type SettingsKekStatus,
  type SettingsSecretBox,
} from '@galaxie/runtime-config/sealed';

import { pool } from '@/lib/auth/db';
import { FEEDBACK_SEALED_TOKEN_KEY, resolveFeedbackSettings } from '@/lib/feedback/settings';
import { readProgressRun } from '@/lib/notifications/store';

import { containerEnv, settingsSecrets } from './panel-secrets';
import { readQuality } from './quality';
import { isTestableSecret } from './secret-tests';
import { readTasks } from './tasks';
import { readYoutube } from './youtube';
import type {
  CreditStatus,
  FeedbackPanelState,
  HistoryRow,
  JobRequestRow,
  JobStatus,
  LlmSpend,
  OpsSetting,
  OpsSnapshot,
  LiveServiceStatus,
  SecretState,
  MirrorSnapshot,
  ModuleStepRow,
  ModulesSnapshot,
  QuotaRow,
  ServiceStatus,
  WorkerView,
} from './types';

/** Scheduler sem relatar há mais que isto = fora do ar (ele relata a cada 30 s). */
const ALIVE_MS = 3 * 60_000;
/** `live` só aparece depois do primeiro relato: com SCHEDULER_LIVE=internal (dev) o ao vivo roda no ingestor. */
const SERVICES: RuntimeService[] = ['ingestor', 'live', 'agents', 'api', 'demo'];
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Tabelas do painel ainda não criadas (migration 0018 pendente). */
export class OpsUnavailableError extends Error {}

async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, params)).rows;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') throw new OpsUnavailableError(String(err));
    throw err;
  }
}

interface EnvRow {
  service: string;
  key: string;
  value: string | null;
  configured: boolean;
  reported_at: Date;
}

async function readSettings(now: Date) {
  const [overrides, envRows] = await Promise.all([
    query<{ key: string; value: string; updated_by: string; updated_at: Date }>(
      'select key, value, updated_by, updated_at from ops.runtime_setting',
    ),
    query<EnvRow>('select service, key, value, configured, reported_at from ops.runtime_env'),
  ]);
  // a demo relata o próprio env do mesmo jeito (segredos só como configurado); o do contêiner, sem as chaves do painel
  const demoAt = now;
  const env = new Map<string, EnvRow>();
  for (const r of envRows) env.set(`${r.service}|${r.key}`, r);
  for (const r of envReportWithKek('demo', containerEnv()))
    env.set(`demo|${r.key}`, { service: 'demo', ...r, reported_at: demoAt });

  const overrideMap = new Map(overrides.map((o) => [o.key, o]));
  // o relato do primeiro serviço que leu a chave (o ao vivo no `live` ou, com SCHEDULER_LIVE=internal, no ingestor)
  const reportedRow = (key: string) => {
    const def = SETTINGS.find((s) => s.key === key);
    return def ? env.get(`${reportedService(def, (svc) => env.has(`${svc}|${key}`))}|${key}`) : undefined;
  };
  const box = settingsSecrets();
  const secretState = (def: SettingDef): SecretState =>
    panelSecretState(
      def,
      overrideMap,
      box,
      (svc) => env.get(`${svc}|SETTINGS_KEK`)?.configured,
      (svc) => parseSettingsKekStatus(env.get(`${svc}|SETTINGS_KEK`)?.value),
    );
  const resolved = resolveAll({
    overrides: new Map(overrides.map((o) => [o.key, o.value])),
    env: (key) => reportedRow(key)?.value ?? null,
  });

  const settings: OpsSetting[] = resolved.map((r) => {
    const def = SETTINGS.find((s) => s.key === r.key)!;
    const reported = reportedRow(r.key);
    const o = overrideMap.get(r.key);
    return {
      key: r.key,
      section: def.section,
      value: isSecret(def) ? null : r.value,
      source: r.source,
      defaultValue: r.defaultValue,
      envValue: isSecret(def) ? null : r.envValue,
      override: isSecret(def) ? null : r.override,
      overrideInvalid: r.overrideInvalid,
      updatedBy: o?.updated_by ?? null,
      updatedAt: iso(o?.updated_at),
      configured: reported?.configured ?? false,
      reportedAt: iso(reported?.reported_at),
      nextRuns:
        def.type === 'cron' && r.value ? nextCronRuns(r.value, 3, now).map((d) => d.toISOString()) : [],
      ...(isSecret(def) ? { secret: secretState(def) } : {}),
    };
  });

  const lastReport = new Map<string, Date>();
  for (const r of envRows) {
    const prev = lastReport.get(r.service);
    if (!prev || r.reported_at > prev) lastReport.set(r.service, r.reported_at);
  }
  const services: ServiceStatus[] = SERVICES.filter((s) => s !== 'live' || lastReport.has(s)).map(
    (service) => {
      const at = service === 'demo' ? demoAt : lastReport.get(service);
      return {
        service,
        reportedAt: iso(at),
        alive:
          service === 'demo' ||
          (service === 'api' ? Boolean(at) : Boolean(at && now.getTime() - at.getTime() < ALIVE_MS)),
      };
    },
  );
  const live = services.find((s) => s.service === 'live');
  if (live) live.live = await readLiveService();

  // tenta abrir o token só para dizer se ele abre; o valor não sai daqui
  const feedbackState = resolveFeedbackSettings(
    new Map(overrides.map((o) => [o.key, o.value])),
    containerEnv(),
    box,
  );
  const sealedToken = overrideMap.get(FEEDBACK_SEALED_TOKEN_KEY);
  const feedback: FeedbackPanelState = {
    tokenInPanel: feedbackState.tokenInPanel,
    tokenUnreadable: feedbackState.tokenUnreadable,
    envTokenConfigured: Boolean(containerEnv().FEEDBACK_GITHUB_TOKEN?.trim()),
    kekConfigured: box !== null,
    tokenChangedBy: sealedToken?.updated_by ?? null,
    tokenChangedAt: iso(sealedToken?.updated_at),
    progress: await readProgressRun().catch(() => null),
  };
  return { settings, services, feedback };
}

/**
 * Situação de uma chave secreta para a tela (#1087): tenta abrir a linha cifrada só para dizer se abre e mostrar os 4
 * últimos caracteres; o valor não sai daqui. `kekReported(svc)` diz se o serviço relatou ter a SETTINGS_KEK
 * (`undefined` = não relatou: não entra no aviso); `kekStatus(svc)`, os ids das KEKs dele (`null` = serviço que não
 * relata os ids: não entra no aviso de KEK diferente).
 */
export function panelSecretState(
  def: SettingDef,
  overrides: ReadonlyMap<string, { value: string; updated_by: string; updated_at: Date }>,
  box: SettingsSecretBox | null,
  kekReported: (service: RuntimeService) => boolean | undefined,
  kekStatus: (service: RuntimeService) => SettingsKekStatus | null = () => null,
): SecretState {
  const editable = isPanelSecret(def);
  const row = editable ? overrides.get(sealedKey(def.key)) : undefined;
  const opened = row && box ? box.open(def.key, row.value) : null;
  // a linha diz com qual KEK foi cifrada; o serviço com KEK curta ou sem esse id não abre (lá vale o .env)
  const kid = row ? sealedKid(row.value) : null;
  const kekMismatch =
    kid === null
      ? []
      : def.services.filter((svc) => {
          // a própria demo já aparece em `unreadable` (abre com o cofre dela, aqui)
          if (svc === 'demo' || kekReported(svc) !== true) return false;
          const status = kekStatus(svc);
          return status !== null && (status.invalid || !status.kids.includes(kid));
        });
  return {
    editable,
    inPanel: Boolean(row),
    unreadable: Boolean(row) && opened === null,
    hint: opened !== null ? secretHint(opened, def.key) : null,
    needsReseal: Boolean(row && box?.needsReseal(def.key, row.value)),
    kekMissing: editable ? def.services.filter((svc) => kekReported(svc) === false) : [],
    kekMismatch,
    canSave: editable && box !== null,
    testable: editable && isTestableSecret(def.key),
    changedBy: row?.updated_by ?? null,
    changedAt: iso(row?.updated_at),
  };
}

/**
 * Líder e último tick do ao vivo (`ops.sync_cursor` do futebol): a época da liderança (`live:leader_epoch`, gravada
 * por quem assume) e o ritmo (`live:scheduler` › `tick`, gravado a cada tick). Sem as linhas, campos nulos.
 */
async function readLiveService(): Promise<LiveServiceStatus> {
  const rows = await query<{
    endpoint: string;
    key: string;
    cursor: Record<string, unknown> | null;
    updated_at: Date;
  }>(
    `select endpoint, key, cursor, updated_at from ops.sync_cursor
      where provider = 'api-sports' and sport = 'football'
        and ((endpoint = 'live:leader_epoch' and key = 'current') or (endpoint = 'live:scheduler' and key = 'tick'))`,
  );
  const leader = rows.find((r) => r.endpoint === 'live:leader_epoch');
  const tick = rows.find((r) => r.endpoint === 'live:scheduler');
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const epoch = Number(leader?.cursor?.epoch);
  return {
    leader: text(leader?.cursor?.instance),
    epoch: Number.isFinite(epoch) ? epoch : null,
    leaderSince: iso(leader?.updated_at),
    lastTickAt: text(tick?.cursor?.lastTickAt),
  };
}

async function readJobs(): Promise<JobStatus[]> {
  const names = SCHEDULED_JOBS.map((j) => j.name);
  const [last, agg, queued] = await Promise.all([
    query<{
      job: string;
      status: string;
      started_at: Date;
      finished_at: Date | null;
      error: string | null;
      stats: { duration_ms?: number; trigger?: string } | null;
    }>(
      `select distinct on (job) job, status, started_at, finished_at, error, stats
         from ops.job_run where job = any($1) order by job, started_at desc`,
      [names],
    ),
    query<{ job: string; last_ok: Date | null; errors_24h: number }>(
      `select job, max(started_at) filter (where status in ('ok', 'budget_skipped')) as last_ok,
              (count(*) filter (where status = 'error' and started_at > now() - interval '24 hours'))::int as errors_24h
         from ops.job_run where job = any($1) and started_at > now() - interval '14 days' group by job`,
      [names],
    ),
    query<{ job: string; status: string; requested_at: Date; requested_by: string }>(
      `select distinct on (job) job, status, requested_at, requested_by from ops.job_request
        where status in ('pending', 'running') order by job, requested_at desc`,
    ),
  ]);
  const lastBy = new Map(last.map((r) => [r.job, r]));
  const aggBy = new Map(agg.map((r) => [r.job, r]));
  const queuedBy = new Map(queued.map((r) => [r.job, r]));
  return SCHEDULED_JOBS.map((j) => {
    const l = lastBy.get(j.name);
    const q = queuedBy.get(j.name);
    return {
      name: j.name,
      service: j.service,
      runNow: j.runNow,
      last: l
        ? {
            status: l.status,
            startedAt: iso(l.started_at)!,
            finishedAt: iso(l.finished_at),
            durationMs:
              l.stats?.duration_ms ??
              (l.finished_at ? l.finished_at.getTime() - l.started_at.getTime() : null),
            error: l.error,
            trigger: l.stats?.trigger ?? null,
          }
        : null,
      lastOkAt: iso(aggBy.get(j.name)?.last_ok),
      errors24h: aggBy.get(j.name)?.errors_24h ?? 0,
      queued: q ? { status: q.status, requestedAt: iso(q.requested_at)!, requestedBy: q.requested_by } : null,
    };
  });
}

async function readQuota(dayUtc: string, settings: OpsSetting[]): Promise<QuotaRow[]> {
  const [ledger, snaps, budgets] = await Promise.all([
    query<{ api: string; priority: string; n: number }>(
      `select api, priority::text, count(*)::int as n from ops.quota_ledger
        where provider = 'api-sports' and day_utc = $1 group by api, priority`,
      [dayUtc],
    ),
    query<{
      api: string;
      provider_used: number;
      provider_limit: number;
      plan: string | null;
      captured_at: Date;
    }>(
      `select api, provider_used, provider_limit, plan, captured_at from ops.quota_snapshot
        where provider = 'api-sports' and day_utc = $1`,
      [dayUtc],
    ),
    query<{ api: string; priority: string; planned: number }>(
      `select api, priority::text, planned from ops.quota_budget where provider = 'api-sports' and day_utc = $1`,
      [dayUtc],
    ),
  ]);
  const value = (key: string) => settings.find((s) => s.key === key)?.value ?? null;
  // futebol sempre; as demais só quando tiveram chamada no dia (o contador do fornecedor conta)
  const apis = new Set<string>([
    'football',
    ...ledger.map((r) => r.api),
    ...snaps.filter((r) => r.provider_used > 0).map((r) => r.api),
  ]);
  return [...apis]
    .sort((a, b) => APISPORTS_APIS.indexOf(a as never) - APISPORTS_APIS.indexOf(b as never))
    .map((api) => {
      const snap = snaps.find((s) => s.api === api);
      const plan = value(planKey(api)) ?? value('APISPORTS_PLAN');
      const used: Record<string, number> = {};
      for (const r of ledger.filter((l) => l.api === api)) used[r.priority] = r.n;
      const planned: Record<string, number> = {};
      for (const r of budgets.filter((b) => b.api === api)) planned[r.priority] = r.planned;
      return {
        api,
        plan,
        dailyLimit:
          snap?.provider_limit ??
          (plan ? (API_PLAN_DAILY_LIMITS[plan as keyof typeof API_PLAN_DAILY_LIMITS] ?? null) : null),
        providerUsed: snap?.provider_used ?? null,
        providerLimit: snap?.provider_limit ?? null,
        capturedAt: iso(snap?.captured_at),
        used,
        totalUsed: Object.values(used).reduce((a, b) => a + b, 0),
        planned,
      };
    });
}

/**
 * Valor numérico de uma flag; vazio, "unlimited", 0 ou inválido = null (sem limite). O 0 recusado
 * (`zeroInvalid`, ex.: AI_DAILY_USD_BUDGET) aparece em `invalid` do Gasto de IA.
 */
function limitSetting(settings: OpsSetting[], key: string): number | null {
  const raw = settings.find((s) => s.key === key)?.value;
  const n = !raw || raw === 'unlimited' || raw === '0' ? null : Number(raw);
  return n !== null && Number.isFinite(n) ? n : null;
}

/** Flags de estado e teto da IA com valor efetivo inválido (ex.: 0 vindo do env): o serviço recusa. */
const AI_STATE_KEYS = [
  'AI_STATUS',
  'AI_AGENT_STATUS',
  'AI_DAILY_TOKEN_BUDGET',
  'AI_DAILY_USD_BUDGET',
  'AI_AGENT_USD_BUDGETS',
  'AI_AGENT_DEFAULT_USD_BUDGET',
  'AI_BAND_SHARES',
  'AI_P0_MIN_AUDIENCE',
  'AI_BUDGET_DAY_START',
  'AI_BUDGET_TIMEZONE',
] as const;

function invalidAiSettings(settings: OpsSetting[]): string[] {
  return AI_STATE_KEYS.flatMap((key) => {
    const value = settings.find((s) => s.key === key)?.value;
    return value && !validateSettingKey(key, value).ok ? [`${key}=${value}`] : [];
  });
}

/** Virada do dia de orçamento efetiva (AI_BUDGET_TIMEZONE e AI_BUDGET_DAY_START; inválida = o padrão). */
function budgetDaySetting(settings: OpsSetting[]) {
  const get = (key: string) => {
    const value = settings.find((s) => s.key === key)?.value;
    return value && validateSettingKey(key, value).ok ? value : null;
  };
  return {
    timeZone: get('AI_BUDGET_TIMEZONE') ?? DEFAULT_BUDGET_DAY.timeZone,
    start: get('AI_BUDGET_DAY_START') ?? DEFAULT_BUDGET_DAY.start,
  };
}

async function readLlm(now: Date, settings: OpsSetting[]): Promise<LlmSpend> {
  const day = budgetDaySetting(settings);
  // o mesmo dia que o ledger usa nos tetos (vira em AI_BUDGET_DAY_START no fuso AI_BUDGET_TIMEZONE)
  const budgetDay = budgetDayOf(now, day);
  const maxSearchesPerCall = limitSetting(settings, 'AI_MAX_SEARCHES_PER_CALL');
  // como o serviço: a lista configurada (painel ou env) mescla por agente sobre os padrões do código
  const rawAgentBudgets = settings.find((s) => s.key === 'AI_AGENT_USD_BUDGETS');
  const codeBudgets = parseAgentUsdBudgets(rawAgentBudgets?.defaultValue) ?? {};
  const configured =
    rawAgentBudgets && rawAgentBudgets.source !== 'default'
      ? (parseAgentUsdBudgets(rawAgentBudgets.value) ?? {})
      : {};
  const agentUsdBudgets = { ...codeBudgets, ...configured };
  const agentUsdOrigins: Record<string, 'db' | 'env' | 'code'> = {};
  for (const agent of Object.keys(codeBudgets)) agentUsdOrigins[agent] = 'code';
  for (const agent of Object.keys(configured))
    agentUsdOrigins[agent] = rawAgentBudgets?.source === 'db' ? 'db' : 'env';
  const status = settings.find((s) => s.key === 'AI_STATUS')?.value?.toLowerCase() === 'off' ? 'off' : 'on';
  const agentStatus = parseAgentStatus(settings.find((s) => s.key === 'AI_AGENT_STATUS')?.value) ?? {};
  const rows = await query<{
    agent: string;
    calls: number;
    input_tokens: string;
    output_tokens: string;
    web_searches: string;
    cost_usd: number;
    errors: number;
    over_search_cap: number;
  }>(
    `select agent, count(*)::int as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
            sum(web_searches) as web_searches, coalesce(sum(cost_usd), 0)::float8 as cost_usd,
            (count(*) filter (where outcome = 'error'))::int as errors,
            (count(*) filter (where $2::int is not null and web_searches > $2::int))::int as over_search_cap
       from ops.llm_usage where coalesce(budget_day, day_utc) = $1 group by agent order by cost_usd desc, agent`,
    [budgetDay, maxSearchesPerCall],
  );
  const bandRows = await query<{ band: string; cost_usd: number }>(
    `select band, coalesce(sum(cost_usd), 0)::float8 as cost_usd
       from ops.llm_usage where coalesce(budget_day, day_utc) = $1 and band is not null group by band`,
    [budgetDay],
  );
  const rawShares = settings.find((s) => s.key === 'AI_BAND_SHARES');
  const shares = parseBandShares(rawShares?.value || rawShares?.defaultValue) ?? parseBandShares(null)!;
  const usdBudget = limitSetting(settings, 'AI_DAILY_USD_BUDGET');
  const limits = bandLimitsUsd(usdBudget, shares);
  const spentBy = new Map(bandRows.map((r) => [r.band, r.cost_usd]));
  const bands = AI_CALL_BANDS.map((band) => ({
    band,
    usedUsd: spentBy.get(band) ?? 0,
    limitUsd: limits[band],
  }));
  const byAgent = rows.map((r) => ({
    agent: r.agent,
    calls: r.calls,
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    webSearches: num(r.web_searches),
    costUsd: r.cost_usd,
    errors: r.errors,
    overSearchCap: r.over_search_cap,
  }));
  const totals = byAgent.reduce(
    (t, a) => ({
      calls: t.calls + a.calls,
      inputTokens: t.inputTokens + a.inputTokens,
      outputTokens: t.outputTokens + a.outputTokens,
      webSearches: t.webSearches + a.webSearches,
      costUsd: t.costUsd + a.costUsd,
      errors: t.errors + a.errors,
      overSearchCap: t.overSearchCap + a.overSearchCap,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0, errors: 0, overSearchCap: 0 },
  );
  return {
    totals,
    byAgent,
    status,
    agentStatus,
    invalid: invalidAiSettings(settings),
    budget: limitSetting(settings, 'AI_DAILY_TOKEN_BUDGET'),
    usdBudget,
    budgetDay,
    day,
    bandShares: shares,
    bands,
    p0MinAudience: limitSetting(settings, 'AI_P0_MIN_AUDIENCE') ?? 25,
    policyOverridden: settings.some(
      (s) =>
        ['AI_BAND_SHARES', 'AI_DAILY_USD_BUDGET', 'AI_P0_MIN_AUDIENCE'].includes(s.key) && s.source === 'db',
    ),
    agentUsdBudgets,
    agentUsdOrigins,
    agentDefaultUsdBudget: limitSetting(settings, 'AI_AGENT_DEFAULT_USD_BUDGET'),
    maxSearchesPerCall,
  };
}

async function readCredit(): Promise<{ credit: CreditStatus | null; pending: boolean }> {
  const [checks, pending] = await Promise.all([
    query<{ status: CreditStatus['status']; detail: string | null; checked_at: Date }>(
      `select status, detail, checked_at from ops.runtime_check where name = $1 order by checked_at desc limit 1`,
      [AI_CREDIT_CHECK],
    ),
    query<{ n: number }>(
      `select count(*)::int as n from ops.job_request where job = $1 and status in ('pending', 'running')`,
      [AI_CREDIT_CHECK],
    ),
  ]);
  const row = checks[0];
  let detail: Record<string, unknown> = {};
  try {
    detail = row?.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {};
  } catch {
    // detalhe antigo em texto: mostra só o status
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    pending: (pending[0]?.n ?? 0) > 0,
    credit: row
      ? {
          status: row.status,
          code: str(detail.code) ?? 'ok',
          provider: str(detail.provider),
          model: str(detail.model),
          http: typeof detail.http === 'number' ? detail.http : null,
          error: str(detail.error),
          checkedAt: iso(row.checked_at)!,
        }
      : null,
  };
}

/**
 * As 100 mudanças mais recentes do histórico de ajustes. Com `key` (o `?chave=` do "Ver no histórico"), o filtro vai
 * no banco: as 100 mais recentes daquela chave, e não só as que caberiam nas 100 mais recentes de todas.
 */
export async function readHistory(key?: string | null): Promise<HistoryRow[]> {
  const rows = await query<{
    id: string;
    key: string;
    action: 'set' | 'reset';
    old_value: string | null;
    new_value: string | null;
    changed_by: string;
    changed_at: Date;
  }>(
    key
      ? `select id, key, action, old_value, new_value, changed_by, changed_at
           from ops.runtime_setting_log where key = any($1) order by changed_at desc, id desc limit 100`
      : `select id, key, action, old_value, new_value, changed_by, changed_at
           from ops.runtime_setting_log order by changed_at desc, id desc limit 100`,
    // segredo trocado no painel: o histórico dele está na linha cifrada (`<CHAVE>_SEALED`)
    key ? [isPanelSecret(settingDef(key)) ? [key, sealedKey(key)] : [key]] : [],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    // a linha cifrada aparece como a chave do registro (o valor nunca: o histórico só tem a máscara)
    key: sealedBaseKey(r.key) && settingDef(sealedBaseKey(r.key)!) ? sealedBaseKey(r.key)! : r.key,
    action: r.action,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedBy: r.changed_by,
    changedAt: iso(r.changed_at)!,
  }));
}

async function readRequests(): Promise<JobRequestRow[]> {
  const rows = await query<{
    id: string;
    job: string;
    status: string;
    requested_by: string;
    requested_at: Date;
    finished_at: Date | null;
    detail: string | null;
  }>(
    `select id::text, job, status, requested_by, requested_at, finished_at, detail
       from ops.job_request where type is null order by requested_at desc limit 20`,
  );
  return rows.map((r) => ({
    id: r.id,
    job: r.job,
    status: r.status,
    requestedBy: r.requested_by,
    requestedAt: iso(r.requested_at)!,
    finishedAt: iso(r.finished_at),
    detail: r.detail,
  }));
}

/** Prazo da concessão da fila (QUEUE_LEASE_MS em @galaxie/db/queue): a última renovação foi este tanto antes do fim. */
const QUEUE_LEASE_MS = 90_000;

interface WorkerTaskRow {
  worker: string;
  id: string;
  type: string;
  attempts: number;
  checkpoint: unknown;
  picked_at: Date | null;
  locked_until: Date | null;
}

/** `checkpoint.progresso` (convenção da fila: `{ feitos, total?, lote? }`). */
function progressOf(checkpoint: unknown): {
  done: number | null;
  total: number | null;
  batch: string | null;
} {
  const p =
    checkpoint && typeof checkpoint === 'object'
      ? (checkpoint as { progresso?: { feitos?: unknown; total?: unknown; lote?: unknown } }).progresso
      : undefined;
  return {
    done: typeof p?.feitos === 'number' ? p.feitos : null,
    total: typeof p?.total === 'number' ? p.total : null,
    batch: typeof p?.lote === 'string' ? p.lote : null,
  };
}

/**
 * Os workers da fila e o que cada um roda, só pelo banco: as tarefas em execução (`locked_by`, `locked_until`, o lote
 * do checkpoint) e quem tomou tarefa nas últimas 24 h (`ops.job_run.stats.worker`). O worker que nunca tomou nada não
 * aparece: o painel não chama o worker por HTTP.
 */
export async function readWorkers(now: Date = new Date()): Promise<WorkerView[]> {
  let running: WorkerTaskRow[];
  let recent: { worker: string; last_seen: Date | null }[];
  try {
    [running, recent] = await Promise.all([
      query<WorkerTaskRow>(
        `select locked_by as worker, id::text, type, attempts, checkpoint, picked_at, locked_until
           from ops.job_request
          where type is not null and status = 'running' and locked_by is not null
          order by picked_at`,
      ),
      query<{ worker: string; last_seen: Date | null }>(
        `select stats->>'worker' as worker, max(finished_at) as last_seen
           from ops.job_run
          where request_id is not null and stats ? 'worker' and started_at > now() - interval '24 hours'
          group by 1`,
      ),
    ]);
  } catch (err) {
    // colunas da fila ainda não migradas: a aba mostra o aviso dela
    if ((err as { code?: string }).code === '42703' || err instanceof OpsUnavailableError) return [];
    throw err;
  }
  const byId = new Map<string, WorkerView>();
  const worker = (id: string) => {
    let w = byId.get(id);
    if (!w) {
      w = { id, state: 'idle', tasks: [], lastSeenAt: null };
      byId.set(id, w);
    }
    return w;
  };
  for (const r of recent) worker(r.worker).lastSeenAt = iso(r.last_seen);
  for (const r of running) {
    const w = worker(r.worker);
    const until = r.locked_until ? new Date(r.locked_until).getTime() : null;
    w.tasks.push({
      id: r.id,
      type: r.type,
      attempts: r.attempts,
      ...progressOf(r.checkpoint),
      pickedAt: iso(r.picked_at),
      lockedUntil: iso(r.locked_until),
      lastRenewAt: until ? new Date(until - QUEUE_LEASE_MS).toISOString() : null,
    });
    const expired = until !== null && until < now.getTime();
    w.state = expired || w.state === 'expired' ? 'expired' : 'busy';
  }
  const order = { expired: 0, busy: 1, idle: 2 } as const;
  return [...byId.values()].sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id));
}

/** Reserva mínima da cota no dev (a mesma do Quota Governor: o dev nunca encosta no que a produção precisa). */
const DEV_MIN_RESERVE_PERCENT = 70;
const PRODUCTION_RESERVE_PERCENT = 25;

/**
 * Espelho: plano e cota de cada API (pelas flags efetivas, como o ingestor) e o inventário que o sync:mirror grava
 * em ops.sync_cursor a cada execução. A reserva segue a regra do Quota Governor (APP_ENV, o mesmo .env da VPS).
 */
async function readMirror(settings: OpsSetting[]): Promise<MirrorSnapshot> {
  const rows = await query<{ sport: string; cursor: unknown }>(
    `select sport, cursor from ops.sync_cursor
      where provider = 'api-sports' and endpoint = $1 and key = $2`,
    [MIRROR_INVENTORY_CURSOR.endpoint, MIRROR_INVENTORY_CURSOR.key],
  );
  const value = (key: string) => settings.find((s) => s.key === key)?.value ?? null;
  const production = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';
  const configured = Number(value('QUOTA_LIVE_RESERVE_PERCENT') ?? Number.NaN);
  const reserve = Number.isFinite(configured) ? configured : PRODUCTION_RESERVE_PERCENT;
  return {
    production,
    reservePercent: production ? reserve : Math.max(reserve, DEV_MIN_RESERVE_PERCENT),
    apis: MIRROR_APIS.map((api) => {
      const plan = value(planKey(api)) ?? value('APISPORTS_PLAN');
      const inventory = parseMirrorInventory(rows.find((r) => r.sport === api)?.cursor);
      // a contagem vem sem o que o plano recusa: depois de trocar de plano ela não vale até a próxima execução
      const otherPlan = inventory?.plan && plan && inventory.plan !== plan ? inventory.plan : null;
      return {
        api,
        plan,
        dailyLimit: plan ? (API_PLAN_DAILY_LIMITS[plan as keyof typeof API_PLAN_DAILY_LIMITS] ?? null) : null,
        inventory: otherPlan ? null : inventory,
        inventoryOtherPlan: otherPlan,
      };
    }),
  };
}

/** Janela do custo medido dos módulos: os últimos dias UTC fechados (o ledger guarda 90). */
const MODULES_WINDOW_DAYS = 7;

interface JobStats {
  phases?: { name?: string; steps?: Record<string, { network?: number }> }[];
}

/** Passos do sync diário por esporte: cada API da agenda das outras 11 vale uma chamada por dia e por data. */
const OTHER_SPORTS_STEP = 'outros-esportes';

/**
 * Custo medido dos módulos: chamadas do ledger por (API, endpoint, job) e chamadas de rede por passo do sync diário
 * (a agenda, a relista e o detalhe usam o mesmo `/fixtures`), nos últimos dias UTC fechados. O job vem de
 * `ops.job_run` pelo `job_id` do ledger (`job-run:<id>`).
 */
async function readModules(now: Date): Promise<ModulesSnapshot> {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - MODULES_WINDOW_DAYS),
  )
    .toISOString()
    .slice(0, 10);
  const [costs, runs] = await Promise.all([
    query<{ api: string; endpoint: string; job: string; calls: number }>(
      `select l.api, l.endpoint, coalesce(j.job, l.job_id, '') as job, count(*)::int as calls
         from ops.quota_ledger l
         left join ops.job_run j on l.job_id = 'job-run:' || j.id::text
        where l.provider = 'api-sports' and l.day_utc >= $1::date and l.day_utc < $2::date
          and l.outcome <> 'pending'
        group by 1, 2, 3`,
      [from, today],
    ),
    query<{ job: string; stats: JobStats | null }>(
      `select job, stats from ops.job_run
        where job in ('sync:daily', 'sync-daily') and started_at >= $1::date and started_at < $2::date
          and stats is not null`,
      [from, today],
    ),
  ]);
  const steps = new Map<string, ModuleStepRow>();
  const add = (api: string, job: string, step: string, calls: number) => {
    const key = `${api}|${job}|${step}`;
    const row = steps.get(key) ?? { api, job, step, calls: 0 };
    row.calls += calls;
    steps.set(key, row);
  };
  for (const run of runs)
    for (const phase of run.stats?.phases ?? [])
      for (const [step, counts] of Object.entries(phase.steps ?? {})) {
        const n = counts?.network ?? 0;
        if (!n) continue;
        // a agenda das outras 11 APIs é um passo só: cada API recebe a parte dela pelo ledger
        if (step === OTHER_SPORTS_STEP) continue;
        add('football', run.job, step, n);
      }
  for (const c of costs)
    if (c.api !== 'football' && (c.job === 'sync:daily' || c.job === 'sync-daily'))
      add(c.api, c.job, OTHER_SPORTS_STEP, c.calls);
  return { windowDays: MODULES_WINDOW_DAYS, from, costs, steps: [...steps.values()] };
}

/**
 * Tudo que o painel mostra, numa leitura. Quem chama confere a sessão de admin (página e rota usam
 * `requireAdmin`/`adminFromHeaders`); esta função não lê cookies, para servir também à checagem do smoke.
 * `historyKey` filtra o histórico de ajustes no banco (o `?chave=` da página do histórico).
 */
export async function readOpsSnapshot(
  now: Date = new Date(),
  options: { historyKey?: string | null } = {},
): Promise<OpsSnapshot> {
  const dayUtc = now.toISOString().slice(0, 10);
  const { settings, services, feedback } = await readSettings(now);
  const [jobs, quota, llm, credit, history, requests, quality, youtube, tasks, workers, mirror, modules] =
    await Promise.all([
      readJobs(),
      readQuota(dayUtc, settings),
      readLlm(now, settings),
      readCredit(),
      readHistory(options.historyKey),
      readRequests(),
      readQuality(),
      readYoutube(now, settings),
      readTasks(),
      readWorkers(now),
      readMirror(settings),
      readModules(now),
    ]);
  return {
    generatedAt: now.toISOString(),
    dayUtc,
    settings,
    feedback,
    services,
    jobs,
    quota,
    llm,
    credit: credit.credit,
    creditPending: credit.pending,
    history,
    requests,
    quality,
    youtube,
    tasks: tasks ? { ...tasks, workers } : null,
    mirror,
    modules,
  };
}
