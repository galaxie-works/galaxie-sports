/**
 * Registro das flags da operação que o painel de Ajustes → Operação mostra e altera. Cada item espelha
 * uma variável de ambiente lida por um serviço; o padrão aqui é o do código (testes em ingestor e
 * ai-agents conferem que não divergem). Segredos entram só para o painel dizer "configurado ou não":
 * nunca têm valor lido, gravado nem exibido.
 */

import {
  BUDGET_DAY_START_PATTERN,
  DEFAULT_BAND_SHARES_TEXT,
  DEFAULT_BUDGET_DAY,
  checkBandShares,
  isTimeZone,
} from './ai-policy.js';
import {
  FOOTBALL_MIRROR_GROUPS,
  MIRROR_APIS,
  MIRROR_BUDGET_DEFAULT_PERCENT,
  MIRROR_BUDGET_KEY,
  MIRROR_BUDGET_MAX_PERCENT,
  MIRROR_GROUP_ORDER_FOOTBALL_KEY,
  MIRROR_GROUP_ORDER_SPORTS_KEY,
  SPORT_MIRROR_GROUPS,
  mirrorGroupOrderError,
  mirrorPeriodsError,
  mirrorPeriodsKey,
} from './mirror.js';
import { MODULE_APIS, modulesError, modulesKey } from './modules.js';
import type { ValidationError } from './resolve.js';

/**
 * Agentes com pool de tokens próprio, fora da soma do AI_DAILY_TOKEN_BUDGET global (fração dele; o
 * ledger, @galaxie/ai-ledger, e o painel leem daqui):
 * - assets=0.2: a ordem das fotos manda ~15 mil tokens por alvo (12 miniaturas); na conta global, ~200
 *   alvos esgotariam 3M de tokens por ~US$ 1,30 e deixariam todos os agentes sem IA até a virada. Com 20%
 *   à parte (600 mil com 3M, ~40 alvos/dia), o lote nunca tira tokens dos outros agentes.
 */
export const SEPARATE_TOKEN_POOLS: Readonly<Record<string, number>> = { assets: 0.2 };

/**
 * Contêiner (ou processo) que lê a variável. `live`: o serviço do ao vivo (scheduler no perfil `live`, #535); com
 * `SCHEDULER_LIVE=internal` (dev, rollback) os jobs dele rodam no `ingestor`, que por isso também lê as flags dele.
 */
export type RuntimeService = 'ingestor' | 'agents' | 'live' | 'api' | 'demo';

export const SETTING_SECTIONS = [
  'live',
  'schedule',
  'ai',
  'wtw',
  'related',
  'provider',
  'mirror',
  'modules',
  'assets',
  'credentials',
  'feedback',
  'cosmos',
  'engage',
] as const;
export type SettingSection = (typeof SETTING_SECTIONS)[number];

export type SettingType = 'cron' | 'enum' | 'int' | 'number' | 'markets' | 'text' | 'secret';

/**
 * Quando uma mudança passa a valer:
 * - `refresh`: o processo em execução relê (scheduler a cada 30 s; ao vivo a cada minuto);
 * - `next-run`: na próxima execução do job (cada execução é um processo novo com o env atualizado);
 * - `restart`: só quando o contêiner reinicia.
 */
export type SettingApply = 'refresh' | 'next-run' | 'restart';

export interface SettingDef {
  key: string;
  section: SettingSection;
  type: SettingType;
  /**
   * Quem lê; o valor do env mostrado no painel é o do primeiro que relatou a chave (`reportedService`), nesta ordem.
   */
  services: readonly RuntimeService[];
  apply: SettingApply;
  /**
   * Serviços em que a mudança chega de outro jeito que `apply` (ex.: a chave da api-sports vale na próxima execução
   * dos jobs do ingestor, mas o ao vivo, um processo contínuo, só a pega ao reiniciar). `settingApplyGroups` junta.
   */
  applyIn?: Partial<Record<RuntimeService, SettingApply>>;
  /** Padrão do código (texto). `null` = sem padrão (vazio). */
  default: string | null;
  /** Padrão que depende de outra flag (ex.: modelo de IA por provedor). */
  defaultBy?: { key: string; values: Readonly<Record<string, string>> };
  /** enum e markets: valores aceitos. */
  options?: readonly string[];
  /** int/number: faixa inclusiva. */
  min?: number;
  max?: number;
  /** int/number: aceita "unlimited" (e 0, quando o serviço trata 0 como "sem limite"). */
  unlimited?: boolean;
  /**
   * 0 é inválido (código `zero`): não quer dizer "desligado" nem "sem limite". int/number: o valor 0;
   * text no formato `chave=valor`: qualquer entrada `=0`. Para desligar a IA: AI_STATUS / AI_AGENT_STATUS.
   */
  zeroInvalid?: boolean;
  /** Aceita vazio (ex.: herdar o plano padrão, usar os mercados dos tenants, modelo padrão). */
  allowEmpty?: boolean;
  /** text: formato aceito. */
  pattern?: RegExp;
  /** text: regra além do formato (ex.: as faixas da IA somam 100); devolve o erro ou null. */
  check?: (value: string) => ValidationError | null;
  /** Mudança sensível (custo ou cobertura): o painel pede confirmação. */
  critical?: boolean;
  /** cron: job agendado. */
  job?: string;
  /**
   * Segredo que o painel troca (#1087): gravado cifrado em `ops.runtime_setting` como `<CHAVE>_SEALED` e aberto pelos
   * serviços com a `SETTINGS_KEK`. Sem a marca, o segredo fica só no .env (a KEK, o login, o banco…). Para segredos,
   * `pattern` é o formato aceito do valor (conferido antes de cifrar e de novo depois de abrir).
   */
  panelSecret?: boolean;
}

/**
 * Jobs agendados: nome (o mesmo de ops.job_run), perfil do scheduler e agenda padrão (UTC). Os do ao vivo são do
 * serviço `live`; com `SCHEDULER_LIVE=internal` o `ingestor` os roda.
 */
export interface ScheduledJobDef {
  name: string;
  service: 'ingestor' | 'agents' | 'live';
  cron: string;
  /**
   * Seguro para "rodar agora" no painel: não gasta cota do fornecedor nem dispara gasto grande de IA
   * (exceção: a reconciliação do ao vivo, o botão de pânico, que gasta poucas chamadas e com teto).
   */
  runNow: boolean;
}

export const SCHEDULED_JOBS: readonly ScheduledJobDef[] = [
  { name: 'sync-daily', service: 'ingestor', cron: '5 0 * * *', runNow: false },
  { name: 'live-run', service: 'live', cron: '*/5 * * * *', runNow: false },
  { name: 'postgame-close', service: 'ingestor', cron: '* * * * *', runNow: true },
  { name: 'live-reconcile', service: 'live', cron: '*/10 * * * *', runNow: true },
  { name: 'sync-mirror', service: 'ingestor', cron: '0 8 * * *', runNow: false },
  { name: 'normalize-football', service: 'ingestor', cron: '35 0 * * *', runNow: true },
  { name: 'normalize-sports', service: 'ingestor', cron: '15 * * * *', runNow: true },
  { name: 'events-clock', service: 'live', cron: '* * * * *', runNow: true },
  { name: 'events-importance', service: 'ingestor', cron: '20 * * * *', runNow: true },
  { name: 'explore-summary', service: 'ingestor', cron: '* * * * *', runNow: true },
  { name: 'assets-mirror', service: 'ingestor', cron: '30 1 * * *', runNow: false },
  { name: 'assets-palette', service: 'ingestor', cron: '10 3 * * *', runNow: true },
  { name: 'change-feed-prune', service: 'ingestor', cron: '45 2 * * *', runNow: true },
  { name: 'data-retention', service: 'ingestor', cron: '20 3 * * *', runNow: true },
  { name: 'fixture-people', service: 'ingestor', cron: '25 4 * * *', runNow: true },
  { name: 'quota-status', service: 'ingestor', cron: '5 * * * *', runNow: true },
  { name: 'data-quality', service: 'ingestor', cron: '40 4 * * *', runNow: true },
  { name: 'cosmos-upkeep', service: 'ingestor', cron: '*/5 * * * *', runNow: true },
  { name: 'bootstrap-catalog', service: 'ingestor', cron: '15 3 * * 1', runNow: false },
  { name: 'recap-run', service: 'agents', cron: '*/5 * * * *', runNow: true },
  { name: 'context-run', service: 'agents', cron: '10 * * * *', runNow: true },
  { name: 'wtw-run', service: 'agents', cron: '*/5 * * * *', runNow: false },
  { name: 'wtw-channel', service: 'agents', cron: '*/10 * * * *', runNow: false },
  { name: 'related-run', service: 'agents', cron: '*/3 * * * *', runNow: false },
  { name: 'wtw-rights', service: 'agents', cron: '40 5,17 * * *', runNow: false },
  { name: 'review-suggestions', service: 'agents', cron: '*/15 * * * *', runNow: true },
  { name: 'lineups-revisit', service: 'agents', cron: '50 4 * * 1', runNow: false },
  { name: 'lineups-pages', service: 'agents', cron: '20 5 * * *', runNow: false },
  { name: 'channel-lists', service: 'agents', cron: '*/10 * * * *', runNow: true },
];

/** Checagem da conta de IA, feita pelo scheduler dos agentes (o painel pede pela mesma fila do "rodar agora"). */
export const AI_CREDIT_CHECK = 'ai-credit-check';

/** Variável da agenda de um job: SCHEDULE_<NOME_EM_MAIÚSCULAS> (ex.: SCHEDULE_QUOTA_STATUS). */
export function scheduleKey(job: string): string {
  return `SCHEDULE_${job.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Valores que desligam um job na agenda. */
export const CRON_OFF_VALUES = ['off', 'false', 'disabled', '0'] as const;

export const API_PLANS = ['free', 'pro', 'ultra', 'mega'] as const;

/** Chamadas por dia de cada plano (espelho de packages/apisports-client/src/plan.ts). */
export const API_PLAN_DAILY_LIMITS: Readonly<Record<(typeof API_PLANS)[number], number>> = {
  free: 100,
  pro: 7500,
  ultra: 75000,
  mega: 150000,
};

/** APIs da api-sports com plano próprio (APISPORTS_PLAN_<ESPORTE>), na ordem do compose. */
export const APISPORTS_APIS = [
  'football',
  'afl',
  'baseball',
  'basketball',
  'formula-1',
  'handball',
  'hockey',
  'mma',
  'nba',
  'american-football',
  'rugby',
  'volleyball',
] as const;

export function planKey(api: string): string {
  return `APISPORTS_PLAN_${api.toUpperCase().replace(/-/g, '_')}`;
}

/**
 * Fechamento pós-jogo (jobs postgame-close): esportes cobertos, um modo e um intervalo por esporte. Fórmula 1
 * fica de fora (as sessões têm pipeline próprio). No futebol, só os jogos fora do plano do ao vivo.
 */
export const POSTGAME_APIS = APISPORTS_APIS.filter((api) => api !== 'formula-1');
/**
 * `fechamento`: confere a partir do fim previsto; `tempo-real`: desde o apito. Os dois no intervalo do esporte; no
 * `tempo-real`, a data sem jogo que ainda possa estar em campo espera ao menos 15 min (postgame/plan.ts).
 */
export const POSTGAME_MODES = ['off', 'fechamento', 'tempo-real'] as const;
export type PostgameMode = (typeof POSTGAME_MODES)[number];

export function postgameModeKey(api: string): string {
  return `POSTGAME_${api.toUpperCase().replace(/-/g, '_')}`;
}

export function postgameIntervalKey(api: string): string {
  return `${postgameModeKey(api)}_MIN`;
}

/** Mercados do Onde Assistir (ISO 3166-1 alfa-2; o mesmo de WTW_COUNTRIES). */
export const WTW_MARKET_CODES = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'] as const;

export const AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
/** Variável da chave de cada provedor (espelho de API_KEY_ENV em services/ai-agents). */
export const AI_PROVIDER_KEY_ENV: Readonly<Record<AiProvider, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};
/** AI_STATUS: ligada ou desligada (literal; nenhum teto numérico desliga a IA). */
export const AI_STATUSES = ['on', 'off'] as const;

/** Modelos padrão por nível e provedor (espelho de DEFAULT_MODELS em services/ai-agents). */
export const AI_DEFAULT_MODELS = {
  light: {
    openai: 'gpt-6-luna',
    anthropic: 'claude-haiku-5-5',
    gemini: 'gemini-3.5-flash-lite',
    deepseek: 'deepseek-flash',
  },
  standard: {
    openai: 'gpt-6.1-sol',
    anthropic: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-flash',
  },
  research: {
    openai: 'gpt-6.1-sol',
    anthropic: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-v4-pro',
  },
} as const satisfies Record<'light' | 'standard' | 'research', Record<AiProvider, string>>;

/**
 * AI_MODEL_PRICES: `modelo=entrada/cache/saída[/gravação]` (US$ por 1 milhão de tokens) separados por
 * vírgula. Espelho de MODEL_PRICES_PATTERN em packages/ai-ledger/src/pricing.ts.
 */
const PRICE_NUM = '\\d+(?:\\.\\d+)?';
const PRICE_ENTRY = `[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,80}=${PRICE_NUM}/(?:${PRICE_NUM})?/${PRICE_NUM}(?:/(?:${PRICE_NUM})?)?`;
export const MODEL_PRICES_PATTERN = new RegExp(`^${PRICE_ENTRY}(?:[,;\\s]+${PRICE_ENTRY})*$`);

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,80}$/;

/** Uma retentativa do canal do jogo: 1–14 dias ou 1–336 horas. */
const RETRY_OFFSET = '(?:(?:[1-9]|1[0-4])d|(?:[1-9]\\d?|[12]\\d\\d|3[0-2]\\d|33[0-6])h)';
/** WTW_CHANNEL_RETRY_OFFSETS: `3d,1d`, `36h`, `3d, 12h` ou `off`. */
export const RETRY_OFFSETS_PATTERN = new RegExp(`^(off|${RETRY_OFFSET}(\\s*,\\s*${RETRY_OFFSET})*)$`);

/**
 * AI_AGENT_USD_BUDGETS: `agente=US$` ou `agente=unlimited` separados por vírgula (agente = prefixo do
 * `purpose` em ops.llm_usage). Espelho de parseAgentUsdBudgets em packages/ai-ledger/src/state.ts.
 */
const AGENT_USD_ENTRY = '[a-z0-9][a-z0-9@._-]*=(\\d+(\\.\\d+)?|unlimited)';
export const AGENT_USD_BUDGETS_PATTERN = new RegExp(`^${AGENT_USD_ENTRY}([,;\\s]+${AGENT_USD_ENTRY})*$`, 'i');
/** AI_AGENT_STATUS: `agente=on` ou `agente=off`. Espelho de parseAgentStatus em packages/ai-ledger. */
const AGENT_STATUS_ENTRY = '[a-z0-9][a-z0-9@._-]*=(on|off)';
export const AGENT_STATUS_PATTERN = new RegExp(
  `^${AGENT_STATUS_ENTRY}([,;\\s]+${AGENT_STATUS_ENTRY})*$`,
  'i',
);

const entries = (raw: string | null | undefined) => (raw ?? '').split(/[,;\s]+/).filter(Boolean);
/** Sem a versão do prompt (`channels@v1` → `channels`), como o ledger grava o agente. */
const agentKey = (name: string) => name.split('@')[0]!.toLowerCase();

/**
 * `lineups=2,wtw=unlimited` → `{ lineups: 2, wtw: null }` (null = sem teto próprio); vazio → `{}`;
 * formato inválido ou US$ 0 → null.
 */
export function parseAgentUsdBudgets(raw: string | null | undefined): Record<string, number | null> | null {
  const out: Record<string, number | null> = {};
  for (const part of entries(raw)) {
    const m = /^([a-z0-9][a-z0-9@._-]*)=(\d+(?:\.\d+)?|unlimited)$/i.exec(part);
    if (!m) return null;
    const value = m[2]!.toLowerCase() === 'unlimited' ? null : Number(m[2]);
    if (value === 0) return null;
    out[agentKey(m[1]!)] = value;
  }
  return out;
}

/** `lineups=on,wtw=off` → `{ lineups: 'on', wtw: 'off' }`; vazio → `{}`; formato inválido → null. */
export function parseAgentStatus(raw: string | null | undefined): Record<string, 'on' | 'off'> | null {
  const out: Record<string, 'on' | 'off'> = {};
  for (const part of entries(raw)) {
    const m = /^([a-z0-9][a-z0-9@._-]*)=(on|off)$/i.exec(part);
    if (!m) return null;
    out[agentKey(m[1]!)] = m[2]!.toLowerCase() as 'on' | 'off';
  }
  return out;
}

const live = (def: Omit<SettingDef, 'section' | 'services' | 'apply'>): SettingDef => ({
  section: 'live',
  services: ['live', 'ingestor'],
  apply: 'refresh',
  ...def,
});
const agents = (
  section: SettingSection,
  def: Omit<SettingDef, 'section' | 'services' | 'apply'>,
): SettingDef => ({ section, services: ['agents'], apply: 'next-run', ...def });
/** Segredo só do .env: o painel mostra se está configurado, com o selo "só no servidor". */
const secret = (key: string, section: SettingSection, services: readonly RuntimeService[]): SettingDef => ({
  key,
  section,
  type: 'secret',
  services,
  apply: 'restart',
  default: null,
});

/**
 * Segredo que o painel troca (#1087). `apply` diz quando a chave nova chega: `next-run` nos jobs do scheduler (cada
 * execução recebe o env com a chave aberta), `refresh` na demo (relê a cada minuto), `restart` na API (lê na partida).
 */
const panelSecret = (
  key: string,
  section: SettingSection,
  services: readonly RuntimeService[],
  pattern: RegExp,
  apply: SettingApply = 'next-run',
  applyIn?: SettingDef['applyIn'],
): SettingDef => ({
  ...secret(key, section, services),
  apply,
  ...(applyIn ? { applyIn } : {}),
  pattern,
  panelSecret: true,
});

/** Formatos dos segredos: só ASCII visível (o valor vira cabeçalho HTTP ou variável de ambiente). */
const SECRET_FORMATS = {
  /** api-sports: 32 caracteres hexadecimais hoje; aceita a faixa por folga. */
  apisports: /^[A-Za-z0-9]{20,128}$/,
  openai: /^sk-[A-Za-z0-9_-]{20,300}$/,
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,300}$/,
  /** Chaves de API do Google (Gemini, YouTube). */
  google: /^AIza[0-9A-Za-z_-]{30,60}$/,
  stripeSecret: /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,300}$/,
  stripeWebhook: /^whsec_[A-Za-z0-9+/=_-]{10,300}$/,
  /** Token de GitHub, de métricas, chave do S3: ASCII visível, sem espaço. */
  token: /^[\x21-\x7e]{16,512}$/,
  /** Usuário e chave de acesso do S3, host e usuário do SMTP. */
  plain: /^[\x21-\x7e]{3,512}$/,
  /** Senha do SMTP: aceita espaço no meio. */
  password: /^[\x21-\x7e](?:[\x20-\x7e]{0,510}[\x21-\x7e])?$/,
} as const;

/** `dono/repositório` das sugestões do app: o mesmo formato no painel e no env (apps/demo/src/lib/feedback). */
export const FEEDBACK_REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.)[\w.-]+$/;

/** Status editoriais da grade de canais e ofertas, do menos ao mais revisado (LINEUP_MIN_REVIEW_STATUS). */
export const LINEUP_REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type LineupMinReviewStatus = (typeof LINEUP_REVIEW_STATUSES)[number];

/** LINEUP_MIN_REVIEW_STATUS do env; vazio = `approved`; valor inválido → erro na partida. */
export function lineupMinReviewStatus(env: Record<string, string | undefined>): LineupMinReviewStatus {
  const raw = env.LINEUP_MIN_REVIEW_STATUS?.trim();
  if (!raw) return 'approved';
  if (!(LINEUP_REVIEW_STATUSES as readonly string[]).includes(raw))
    throw new Error(`LINEUP_MIN_REVIEW_STATUS inválido: ${raw} (use draft, reviewed ou approved)`);
  return raw as LineupMinReviewStatus;
}

export const SETTINGS: readonly SettingDef[] = [
  // ── Ao vivo ─────────────────────────────────────────────────────────────────────────────────
  live({
    key: 'LIVE_FEATURED',
    type: 'enum',
    options: ['off', 'auto', 'on'],
    default: 'off',
    critical: true,
  }),
  live({ key: 'LIVE_MAX_INTERVAL_MINUTES', type: 'number', min: 1, max: 60, default: '15' }),
  live({ key: 'LIVE_IDLE_EXIT_MINUTES', type: 'int', min: 1, max: 240, default: '15' }),
  live({ key: 'LIVE_MIN_PRIORITY', type: 'enum', options: ['high', 'medium', 'low'], default: 'medium' }),
  live({ key: 'LIVE_PROTECT_DAILY', type: 'int', min: 0, max: 150_000, default: null, allowEmpty: true }),
  {
    key: 'LIVE_POLL_INTERVAL_SECONDS',
    section: 'live',
    type: 'int',
    services: ['api'],
    apply: 'restart',
    min: 15,
    max: 3600,
    default: '300',
  },

  // ── Agenda dos jobs ─────────────────────────────────────────────────────────────────────────
  ...SCHEDULED_JOBS.map((j): SettingDef => ({
    key: scheduleKey(j.name),
    section: 'schedule',
    type: 'cron',
    // o ingestor também lê a agenda dos jobs do ao vivo (SCHEDULER_LIVE=internal)
    services: j.service === 'live' ? ['live', 'ingestor'] : [j.service],
    apply: 'refresh',
    default: j.cron,
    job: j.name,
    critical: j.name === 'live-run' || j.name === 'sync-daily',
  })),
  {
    key: 'CHANGE_FEED_RETENTION_DAYS',
    section: 'schedule',
    type: 'int',
    services: ['ingestor'],
    apply: 'next-run',
    min: 1,
    max: 90,
    default: '7',
  },

  // ── IA e orçamento ──────────────────────────────────────────────────────────────────────────
  agents('ai', {
    key: 'AI_PROVIDER',
    type: 'enum',
    options: AI_PROVIDERS,
    default: 'openai',
    critical: true,
  }),
  ...(['light', 'standard', 'research'] as const).map((tier) =>
    agents('ai', {
      key: `AI_MODEL_${tier.toUpperCase()}`,
      type: 'text',
      pattern: MODEL_ID,
      allowEmpty: true,
      default: null,
      defaultBy: { key: 'AI_PROVIDER', values: AI_DEFAULT_MODELS[tier] },
    }),
  ),
  // ligado/desligado é literal: off = nenhuma chamada ao LLM (os tetos abaixo só limitam)
  agents('ai', { key: 'AI_STATUS', type: 'enum', options: AI_STATUSES, default: 'on', critical: true }),
  // desliga agentes com a IA ligada (agente=on e vazio seguem o AI_STATUS, que é a chave geral)
  agents('ai', {
    key: 'AI_AGENT_STATUS',
    type: 'text',
    pattern: AGENT_STATUS_PATTERN,
    allowEmpty: true,
    default: null,
    critical: true,
  }),
  // tetos: "unlimited" ou o número; 0 é inválido (para desligar, AI_STATUS=off)
  agents('ai', {
    key: 'AI_DAILY_TOKEN_BUDGET',
    type: 'int',
    min: 10_000,
    max: 100_000_000,
    unlimited: true,
    zeroInvalid: true,
    default: '2000000',
    critical: true,
  }),
  // teto em US$ (tokens + buscas na web) somando todos os agentes; o de tokens acima continua valendo
  agents('ai', {
    key: 'AI_DAILY_USD_BUDGET',
    type: 'number',
    min: 0.5,
    max: 10_000,
    unlimited: true,
    zeroInvalid: true,
    default: '10',
    critical: true,
  }),
  // teto em US$ por agente (vazio = o padrão; agente fora da lista fica no AI_AGENT_DEFAULT_USD_BUDGET)
  agents('ai', {
    key: 'AI_AGENT_USD_BUDGETS',
    type: 'text',
    pattern: AGENT_USD_BUDGETS_PATTERN,
    zeroInvalid: true,
    allowEmpty: true,
    default:
      'lineups=2,wtw=3,context=1.5,related=0.5,f1profile=2,f1bio=1,curator=1,review=0.5,channels=1,live=0.5,assets=1',
    critical: true,
  }),
  // teto em US$ do agente fora de AI_AGENT_USD_BUDGETS (agente novo): conservador, com aviso diário no log
  agents('ai', {
    key: 'AI_AGENT_DEFAULT_USD_BUDGET',
    type: 'number',
    min: 0.05,
    max: 1_000,
    unlimited: true,
    zeroInvalid: true,
    default: '0.5',
    critical: true,
  }),
  // política de execução (#357): o teto global dividido em faixas por prioridade (% que somam 100)
  agents('ai', {
    key: 'AI_BAND_SHARES',
    type: 'text',
    pattern: /^[a-z0-9]+=\d{1,3}([,;\s]+[a-z0-9]+=\d{1,3})*$/i,
    check: (value) => {
      const r = checkBandShares(value);
      return r.ok ? null : r.error;
    },
    default: DEFAULT_BAND_SHARES_TEXT,
    critical: true,
  }),
  // corte P0/P1: audiência mínima (pontos de config/geo/market-audience.yaml) para a competição ser P0
  agents('ai', { key: 'AI_P0_MIN_AUDIENCE', type: 'int', min: 1, max: 40, default: '25', critical: true }),
  // virada do dia de orçamento (todos os tetos de IA): horário local e fuso
  agents('ai', {
    key: 'AI_BUDGET_DAY_START',
    type: 'text',
    pattern: BUDGET_DAY_START_PATTERN,
    default: DEFAULT_BUDGET_DAY.start,
    critical: true,
  }),
  agents('ai', {
    key: 'AI_BUDGET_TIMEZONE',
    type: 'text',
    pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/,
    check: (value) => (isTimeZone(value) ? null : { code: 'format' }),
    default: DEFAULT_BUDGET_DAY.timeZone,
    critical: true,
  }),
  // buscas na web por chamada: OpenAI e Anthropic aplicam na API; o Gemini recebe no prompt e o
  // painel conta as chamadas que passaram do teto
  agents('ai', {
    key: 'AI_MAX_SEARCHES_PER_CALL',
    type: 'int',
    min: 1,
    max: 50,
    unlimited: true,
    default: '5',
    critical: true,
  }),
  agents('ai', { key: 'AI_MAX_RETRIES', type: 'int', min: 0, max: 10, default: '3' }),
  // preço por token por cima da tabela do código (packages/ai-ledger): conta de gasto e teto em US$
  {
    key: 'AI_MODEL_PRICES',
    section: 'ai',
    type: 'text',
    services: ['agents', 'ingestor'],
    apply: 'next-run',
    pattern: MODEL_PRICES_PATTERN,
    allowEmpty: true,
    default: null,
    critical: true,
  },
  agents('ai', { key: 'AI_TIMEOUT_MS', type: 'int', min: 10_000, max: 600_000, default: '180000' }),
  // revisão das sugestões de edição da base semântica (job review-suggestions): Gemini por padrão
  agents('ai', { key: 'AI_REVIEW_PROVIDER', type: 'enum', options: AI_PROVIDERS, default: 'gemini' }),
  agents('ai', { key: 'AI_REVIEW_MODEL', type: 'text', pattern: MODEL_ID, allowEmpty: true, default: null }),
  // casamento da lista de canais do cliente (job channel-lists): Gemini por padrão, só nas sobras
  agents('ai', { key: 'AI_CHANNELS_PROVIDER', type: 'enum', options: AI_PROVIDERS, default: 'gemini' }),
  agents('ai', {
    key: 'AI_CHANNELS_MODEL',
    type: 'text',
    pattern: MODEL_ID,
    allowEmpty: true,
    default: null,
  }),

  // ── Onde Assistir ───────────────────────────────────────────────────────────────────────────
  agents('wtw', {
    key: 'WTW_MARKETS',
    type: 'markets',
    options: WTW_MARKET_CODES,
    allowEmpty: true,
    default: null,
  }),
  agents('wtw', { key: 'WTW_MIN_RELEVANCE', type: 'number', min: 0, max: 100, default: '60' }),
  // alocação por rodada do wtw-run (desenho anterior); o canal do jogo é do job wtw-channel
  agents('wtw', { key: 'WTW_ROUND_ALLOCATION', type: 'enum', options: ['off', 'on'], default: 'off' }),
  // canal do jogo (wtw-channel): Gemini por padrão — o grounding garante as URLs das fontes
  agents('wtw', {
    key: 'AI_MATCH_CHANNEL_PROVIDER',
    type: 'enum',
    options: AI_PROVIDERS,
    allowEmpty: true,
    default: null,
  }),
  agents('wtw', {
    key: 'AI_MATCH_CHANNEL_MODEL',
    type: 'text',
    pattern: MODEL_ID,
    allowEmpty: true,
    default: null,
  }),
  // pesquisa de direitos por temporada com outro provedor (vazio = o AI_PROVIDER dos demais agentes)
  agents('wtw', {
    key: 'AI_RIGHTS_PROVIDER',
    type: 'enum',
    options: AI_PROVIDERS,
    allowEmpty: true,
    default: null,
  }),
  agents('wtw', { key: 'AI_RIGHTS_MODEL', type: 'text', pattern: MODEL_ID, allowEmpty: true, default: null }),
  // momentos do canal do jogo (wtw-channel roda a cada 10 min; estes decidem quando há pesquisa):
  // consulta semanal das rodadas de 3 a 10 dias à frente, retentativas só para quem segue sem canal
  // confirmado e pós-jogo dos encerrados sem canal (services/ai-agents/src/wtw/channel/windows.ts)
  agents('wtw', { key: 'WTW_CHANNEL_WEEKLY_CRON', type: 'cron', default: '0 6 * * 1', critical: true }),
  agents('wtw', {
    key: 'WTW_CHANNEL_RETRY_OFFSETS',
    type: 'text',
    // `3d,1d` ou horas (`36h`), de 1 h a 14 d; `off` = sem retentativas (espelho de parseRetryOffsets)
    pattern: RETRY_OFFSETS_PATTERN,
    // 6h: última chance antes do jogo (a escala por jogo — ex.: o exclusivo do Prime Video — às
    // vezes só sai na véspera, e a pesquisa de 1d pode ter falhado)
    default: '3d,1d,6h',
    critical: true,
  }),
  agents('wtw', { key: 'WTW_CHANNEL_POST', type: 'enum', options: ['off', 'on'], default: 'on' }),
  agents('wtw', {
    key: 'WTW_DAILY_USD_PER_MARKET',
    type: 'number',
    min: 0,
    max: 1000,
    unlimited: true,
    default: '1',
    critical: true,
  }),

  {
    // piso editorial da grade de canais e ofertas (plataformas e planos do onde assistir, /v1/platforms);
    // mesmo padrão do SEMANTIC_MIN_REVIEW_STATUS: produção serve só o aprovado
    key: 'LINEUP_MIN_REVIEW_STATUS',
    section: 'wtw',
    type: 'enum',
    options: LINEUP_REVIEW_STATUSES,
    services: ['api'],
    apply: 'restart',
    default: 'approved',
  },
  // texto das páginas de planos que a pesquisa e a revisita da grade (lineups) mandam ao modelo na
  // extração: por plataforma (dividido entre as páginas) e por página; o que passa é cortado do fim
  // (services/ai-agents/src/lineups/prompt.ts, LINEUP_PROMPT_LIMITS)
  agents('wtw', {
    key: 'LINEUP_PROMPT_MAX_CHARS',
    type: 'int',
    min: 10_000,
    max: 600_000,
    default: '150000',
    critical: true,
  }),
  agents('wtw', {
    key: 'LINEUP_PAGE_MAX_CHARS',
    type: 'int',
    min: 5_000,
    max: 600_000,
    default: '150000',
    critical: true,
  }),

  // ── Conteúdo relacionado ────────────────────────────────────────────────────────────────────
  // dois baldes da YouTube Data API: busca (consultas/dia) e geral (unidades/dia) — related/budget.ts
  agents('related', {
    key: 'YOUTUBE_SEARCH_DAILY_QUOTA',
    type: 'int',
    min: 0,
    max: 1_000_000,
    default: '100',
    critical: true,
  }),
  agents('related', { key: 'YOUTUBE_DAILY_QUOTA', type: 'int', min: 0, max: 1_000_000, default: '10000' }),
  agents('related', { key: 'YOUTUBE_QUOTA_RESERVE_PERCENT', type: 'int', min: 0, max: 90, default: '10' }),
  agents('related', { key: 'RELATED_RESEARCH_HOURS', type: 'int', min: 1, max: 168, default: '12' }),
  // fila e orçamento dos vídeos (services/ai-agents/src/related/priority.ts)
  agents('related', {
    key: 'RELATED_MARKETS',
    type: 'markets',
    options: WTW_MARKET_CODES,
    allowEmpty: true,
    default: null,
  }),
  agents('related', { key: 'RELATED_MIN_RELEVANCE', type: 'int', min: 0, max: 100, default: '50' }),
  agents('related', { key: 'RELATED_MAX_VIDEOS', type: 'int', min: 1, max: 50, default: '12' }),
  agents('related', {
    key: 'RELATED_MARKET_WEIGHTS',
    type: 'text',
    pattern: /^[A-Za-z]{2}:\d+(\.\d+)?([,\s]+[A-Za-z]{2}:\d+(\.\d+)?)*$/,
    allowEmpty: true,
    default: 'BR:1,AR:0.6,MX:0.6,CO:0.45,CL:0.4,PE:0.35,UY:0.35,EC:0.35',
  }),
  agents('related', { key: 'RELATED_MAX_SEARCHES_PER_EVENT', type: 'int', min: 0, max: 16, default: '4' }),
  agents('related', { key: 'RELATED_MAX_SEARCHES_PER_RUN', type: 'int', min: 0, max: 16, default: '2' }),
  agents('related', { key: 'RELATED_CHANNEL_ENOUGH', type: 'int', min: 1, max: 50, default: '4' }),
  agents('related', {
    key: 'RELATED_CHANNEL_REFRESH_MINUTES',
    type: 'int',
    min: 0,
    max: 1440,
    default: '60',
  }),
  agents('related', { key: 'RELATED_REVALIDATE_MINUTES', type: 'int', min: 0, max: 1440, default: '120' }),
  agents('related', { key: 'RELATED_RESERVE_MAX_PERCENT', type: 'int', min: 0, max: 90, default: '60' }),
  agents('related', {
    key: 'RELATED_SEARCH_AFTER_KICKOFF_MINUTES',
    type: 'int',
    min: 0,
    max: 600,
    default: '140',
  }),
  agents('related', { key: 'RELATED_LOOKBACK_HOURS', type: 'int', min: 1, max: 168, default: '24' }),
  agents('related', { key: 'RELATED_SECOND_SEARCH_MINUTES', type: 'int', min: 0, max: 720, default: '30' }),
  agents('related', {
    key: 'RELATED_CREATOR_MIN_SUBSCRIBERS',
    type: 'int',
    min: 0,
    max: 100_000_000,
    default: '100000',
  }),

  // ── Fornecedor (planos e cota) ──────────────────────────────────────────────────────────────
  {
    key: 'APISPORTS_PLAN',
    section: 'provider',
    type: 'enum',
    options: API_PLANS,
    services: ['ingestor', 'api'],
    apply: 'next-run',
    default: 'free',
    critical: true,
  },
  ...POSTGAME_APIS.flatMap((api): SettingDef[] => [
    {
      key: postgameModeKey(api),
      section: 'live',
      type: 'enum',
      options: POSTGAME_MODES,
      services: ['ingestor'],
      apply: 'next-run',
      default: 'fechamento',
    },
    {
      key: postgameIntervalKey(api),
      section: 'live',
      type: 'int',
      services: ['ingestor'],
      apply: 'next-run',
      min: 1,
      max: 180,
      default: '15',
    },
  ]),
  {
    // teto de chamadas do fechamento pós-jogo por esporte e dia UTC (fora da agenda diária)
    key: 'POSTGAME_MAX_CALLS_DAY',
    section: 'live',
    type: 'int',
    services: ['ingestor'],
    apply: 'next-run',
    min: 1,
    max: 2_000,
    default: '40',
  },
  ...APISPORTS_APIS.map((api): SettingDef => ({
    key: planKey(api),
    section: 'provider',
    type: 'enum',
    options: API_PLANS,
    services: ['ingestor', 'api'],
    apply: 'next-run',
    allowEmpty: true,
    default: null,
    critical: true,
  })),
  {
    // produção: abaixo disso só o ao vivo chama; no dev o Governor impõe pelo menos 70% (vale para tudo)
    key: 'QUOTA_LIVE_RESERVE_PERCENT',
    section: 'provider',
    type: 'int',
    services: ['ingestor', 'api'],
    apply: 'next-run',
    min: 0,
    max: 50,
    default: '25',
  },

  // ── Espelho da api-sports (sync:mirror; catálogo e regras em mirror.ts) ──────────────────────
  {
    // parte da cota diária de cada API paga; o free fica em 10 chamadas
    key: MIRROR_BUDGET_KEY,
    section: 'mirror',
    type: 'int',
    services: ['ingestor'],
    apply: 'next-run',
    min: 1,
    max: MIRROR_BUDGET_MAX_PERCENT,
    zeroInvalid: true,
    default: String(MIRROR_BUDGET_DEFAULT_PERCENT),
    critical: true,
  },
  ...(
    [
      [MIRROR_GROUP_ORDER_FOOTBALL_KEY, 'football', FOOTBALL_MIRROR_GROUPS],
      [MIRROR_GROUP_ORDER_SPORTS_KEY, 'basketball', SPORT_MIRROR_GROUPS],
    ] as const
  ).map(([key, api, groups]): SettingDef => ({
    key,
    section: 'mirror',
    type: 'text',
    services: ['ingestor'],
    apply: 'next-run',
    check: (value) => mirrorGroupOrderError(api, value),
    default: groups.join(','),
  })),
  // períodos por endpoint e tier: só o que difere do padrão (vazio = todos no padrão do código)
  ...MIRROR_APIS.map((api): SettingDef => ({
    key: mirrorPeriodsKey(api),
    section: 'mirror',
    type: 'text',
    services: ['ingestor'],
    apply: 'next-run',
    allowEmpty: true,
    check: (value) => mirrorPeriodsError(api, value),
    default: null,
    critical: true,
  })),

  // módulos por esporte e tier fora do espelho (sync diário, ao vivo, agentes): só o que difere do padrão do código
  // (modules.ts); os do espelho ficam em MIRROR_PERIODS_<API>. O ao vivo relê a cada minuto; os jobs, na próxima
  // execução
  ...MODULE_APIS.map((api): SettingDef => ({
    key: modulesKey(api),
    section: 'modules',
    type: 'text',
    services: ['ingestor', 'live', 'agents'],
    apply: 'next-run',
    applyIn: { live: 'refresh' },
    allowEmpty: true,
    check: (value) => modulesError(api, value),
    default: null,
    critical: true,
  })),

  // ── Logos ───────────────────────────────────────────────────────────────────────────────────
  {
    // acervo customizado (assets:acervo): ligado, a API serve o logo do acervo onde houver mapeamento
    key: 'ASSETS_CUSTOM_LOGOS',
    section: 'assets',
    type: 'enum',
    options: ['off', 'on'],
    services: ['api'],
    apply: 'refresh',
    default: 'off',
    critical: true,
  },

  // ── Sugestões do app ("Sugerir ou reportar algo") ───────────────────────────────────────────
  // a demo relê a cada envio e a cada carga da página. O token que o painel grava é outra chave, cifrada e fora deste
  // registro (FEEDBACK_GITHUB_TOKEN_SEALED em apps/demo/src/lib/feedback/settings.ts); o secret abaixo é o do .env
  {
    key: 'FEEDBACK_ENABLED',
    section: 'feedback',
    type: 'enum',
    options: ['off', 'on'],
    services: ['demo'],
    apply: 'refresh',
    default: 'on',
  },
  {
    key: 'FEEDBACK_GITHUB_REPO',
    section: 'feedback',
    type: 'text',
    pattern: FEEDBACK_REPO_PATTERN,
    services: ['demo'],
    apply: 'refresh',
    allowEmpty: true,
    default: null,
  },
  // o token do painel é a mesma chave cifrada (FEEDBACK_GITHUB_TOKEN_SEALED), gravada pelo cartão do GitHub
  panelSecret('FEEDBACK_GITHUB_TOKEN', 'feedback', ['demo'], SECRET_FORMATS.token, 'refresh'),
  // Stripe da Galaxie Works LLC (#993): a chave secreta abre o checkout no painel do cliente; o segredo do webhook confere
  // a assinatura na API. Sem elas a compra fica indisponível
  panelSecret('STRIPE_SECRET_KEY', 'cosmos', ['demo', 'ingestor'], SECRET_FORMATS.stripeSecret, 'refresh'),
  panelSecret('STRIPE_WEBHOOK_SECRET', 'cosmos', ['api'], SECRET_FORMATS.stripeWebhook, 'restart'),
  // IAs externas da Cosmos AI (assistente e moderação dos clientes), separadas das chaves da IA interna: o gasto de cada
  // lado fica na conta própria do provedor. Quem lê é o assistente na demo, a cada pedido (process.env): a chave trocada
  // no painel vale em até 1 minuto. Vazia, o assistente responde "indisponível"
  panelSecret('COSMOS_OPENAI_API_KEY', 'cosmos', ['demo'], SECRET_FORMATS.openai, 'refresh'),
  panelSecret('COSMOS_ANTHROPIC_API_KEY', 'cosmos', ['demo'], SECRET_FORMATS.anthropic, 'refresh'),
  panelSecret('COSMOS_GEMINI_API_KEY', 'cosmos', ['demo'], SECRET_FORMATS.google, 'refresh'),
  panelSecret('COSMOS_DEEPSEEK_API_KEY', 'cosmos', ['demo'], SECRET_FORMATS.openai, 'refresh'),

  // ── Cosmos AI (#989) ──────────────────────────────────────────────────────────────────────────
  // teto de segurança próprio da Cosmos: o custo real somado de todos os clientes no dia UTC (cosmos.ledger), fora do
  // AI_DAILY_USD_BUDGET dos agentes internos. Passou dele, a reserva recusa até a virada; quem chama cai para regras
  // e pessoas. Relido a cada reserva
  {
    key: 'COSMOS_DAILY_USD_CEILING',
    section: 'cosmos',
    type: 'number',
    min: 1,
    max: 100_000,
    unlimited: true,
    zeroInvalid: true,
    services: ['api'],
    apply: 'refresh',
    default: '25',
    critical: true,
  },
  // cotação operacional (R$ por US$) para a margem das Carteiras da Cosmos em Ajustes (#1002): a receita em reais vira
  // dólar para comparar com o custo do provedor. Sem padrão no código (número da Galaxie); vazio, a margem em reais
  // aparece como "—"
  {
    key: 'COSMOS_USD_BRL',
    section: 'cosmos',
    type: 'number',
    min: 0.5,
    max: 100,
    zeroInvalid: true,
    allowEmpty: true,
    services: ['demo'],
    apply: 'refresh',
    default: null,
  },
  // créditos de teste ao ligar a Cosmos pela primeira vez (uma vez por tenant) e a validade deles; comprados não vencem
  {
    key: 'COSMOS_TRIAL_CREDITS',
    section: 'cosmos',
    type: 'int',
    min: 1,
    max: 100_000,
    services: ['demo'],
    apply: 'refresh',
    default: '250',
    critical: true,
  },
  {
    key: 'COSMOS_TRIAL_DAYS',
    section: 'cosmos',
    type: 'int',
    min: 1,
    max: 365,
    services: ['demo'],
    apply: 'refresh',
    default: '90',
  },
  // valor de 1 crédito em US$ de custo de provedor (converte o custo real em créditos). Sem padrão no código: o número
  // é da Galaxie e fica só no banco. Vazio, cada chamada cobra o mínimo da função
  {
    key: 'COSMOS_CREDIT_USD',
    section: 'cosmos',
    type: 'number',
    min: 0.000001,
    max: 10,
    zeroInvalid: true,
    allowEmpty: true,
    services: ['api'],
    apply: 'refresh',
    default: null,
    critical: true,
  },

  // teto da Galaxie para a autonomia da moderação da Cosmos (#997): o cliente escolhe o degrau de cada ação dentro dele.
  // `flag` só sinaliza, `notify` age e avisa, `auto` age sozinha. Suspender e banir não têm teto aqui: pedem pessoa
  {
    key: 'COSMOS_MOD_HIDE_MAX',
    section: 'cosmos',
    type: 'enum',
    options: ['flag', 'notify', 'auto'],
    services: ['demo', 'api'],
    apply: 'refresh',
    default: 'auto',
  },
  {
    key: 'COSMOS_MOD_MUTE_MAX',
    section: 'cosmos',
    type: 'enum',
    options: ['flag', 'notify', 'auto'],
    services: ['demo', 'api'],
    apply: 'refresh',
    default: 'auto',
  },
  // horas máximas de um Silêncio aplicado pela Cosmos (nunca passa de 24)
  {
    key: 'COSMOS_MOD_MUTE_MAX_HOURS',
    section: 'cosmos',
    type: 'int',
    min: 1,
    max: 24,
    services: ['demo', 'api'],
    apply: 'refresh',
    default: '24',
  },
  // provedor dos embeddings da busca por significado do assistente (base de conhecimento). `auto`: o primeiro com chave
  // da Cosmos (OpenAI, depois Gemini); `off` ou sem chave: só a busca por palavras
  {
    key: 'COSMOS_EMBEDDINGS_PROVIDER',
    section: 'cosmos',
    type: 'enum',
    options: ['auto', 'openai', 'gemini', 'off'],
    services: ['demo'],
    apply: 'refresh',
    default: 'auto',
  },

  // ── Engajamento (#1017) ───────────────────────────────────────────────────────────────────────
  // validade do token do torcedor (gft_, #937). Curta: punição e exclusão valem na hora pelo Valkey, mas faixa e
  // país só mudam no próximo token. Relido a cada minuto; os segredos ficam no .env (FAN_TOKEN_SECRET)
  {
    key: 'FAN_TOKEN_TTL_SECONDS',
    section: 'engage',
    type: 'int',
    min: 60,
    max: 3600,
    services: ['api'],
    apply: 'refresh',
    default: '900',
  },
  secret('FAN_TOKEN_SECRET', 'engage', ['api']),
  // jogos ao mesmo tempo em que um Perfil conta presença ao vivo (#906, antirrobô). O cliente só pode baixar
  {
    key: 'FAN_PRESENCE_MAX_GAMES',
    section: 'engage',
    type: 'int',
    min: 1,
    max: 10,
    services: ['api'],
    apply: 'refresh',
    default: '3',
  },
  // Chat ao vivo (#915, #959, #964): padrão e teto da Galaxie. O cliente ajusta a janela, o modo lento e o rigor dentro
  // destes limites (chat.tenant_config); tamanho e histórico ficam só aqui. Relidos a cada minuto
  {
    key: 'CHAT_ROOM_OPEN_BEFORE_MINUTES',
    section: 'engage',
    type: 'int',
    min: 0,
    max: 1440,
    services: ['api'],
    apply: 'refresh',
    default: '60',
  },
  {
    key: 'CHAT_ROOM_CLOSE_AFTER_MINUTES',
    section: 'engage',
    type: 'int',
    min: 0,
    max: 1440,
    services: ['api'],
    apply: 'refresh',
    default: '30',
  },
  {
    key: 'CHAT_SLOW_MODE_SECONDS',
    section: 'engage',
    type: 'int',
    min: 0,
    max: 600,
    services: ['api'],
    apply: 'refresh',
    default: '3',
  },
  {
    key: 'CHAT_MESSAGE_MAX_CHARS',
    section: 'engage',
    type: 'int',
    min: 20,
    max: 500,
    services: ['api'],
    apply: 'refresh',
    default: '280',
  },
  {
    key: 'CHAT_HISTORY_ON_JOIN',
    section: 'engage',
    type: 'int',
    min: 0,
    max: 200,
    services: ['api'],
    apply: 'refresh',
    default: '50',
  },
  // Shopping (#916): horas do cache de preço e estoque dos conectores de loja. O épico fixa o teto em 24 h
  {
    key: 'SHOP_PRICE_CACHE_HOURS',
    section: 'engage',
    type: 'int',
    min: 1,
    max: 24,
    services: ['api'],
    apply: 'restart',
    default: '24',
  },
  // Shopping (#921): tenants da própria Galaxie (site e app), os únicos que recebem o código de afiliado da Galaxie.
  // Vazio = nenhum (o padrão seguro); ids de tenant separados por vírgula
  {
    key: 'SHOP_GALAXIE_TENANT_IDS',
    section: 'engage',
    type: 'text',
    pattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([,;\s]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*$/i,
    allowEmpty: true,
    services: ['api'],
    apply: 'restart',
    default: '',
    critical: true,
  },

  // ── Credenciais ─────────────────────────────────────────────────────────────────────────────
  // trocadas no painel (#1087): cifradas no banco, abertas por cada serviço com a SETTINGS_KEK dele
  // o ao vivo monta o cliente da api-sports uma vez e roda sem parar (líder e reserva): a chave nova só ao reiniciar
  panelSecret('APISPORTS_KEY', 'provider', ['ingestor', 'live'], SECRET_FORMATS.apisports, 'next-run', {
    live: 'restart',
  }),
  panelSecret('OPENAI_API_KEY', 'ai', ['agents'], SECRET_FORMATS.openai),
  panelSecret('ANTHROPIC_API_KEY', 'ai', ['agents'], SECRET_FORMATS.anthropic),
  panelSecret('GEMINI_API_KEY', 'ai', ['agents'], SECRET_FORMATS.google),
  // DeepSeek (API compatível com a da OpenAI, #1088)
  panelSecret('DEEPSEEK_API_KEY', 'ai', ['agents'], SECRET_FORMATS.openai),
  panelSecret('YOUTUBE_API_KEY', 'related', ['agents'], SECRET_FORMATS.google),
  // a demo refaz o cliente S3 quando a chave muda (anexos, logos): vale na releitura de um minuto
  panelSecret('S3_ACCESS_KEY', 'credentials', ['ingestor', 'demo'], SECRET_FORMATS.plain, 'next-run', {
    demo: 'refresh',
  }),
  panelSecret('QUALITY_API_KEY', 'credentials', ['ingestor'], SECRET_FORMATS.token),
  panelSecret('S3_SECRET_KEY', 'credentials', ['ingestor', 'demo'], SECRET_FORMATS.plain, 'next-run', {
    demo: 'refresh',
  }),
  panelSecret('SMTP_HOST', 'credentials', ['demo'], SECRET_FORMATS.plain, 'refresh'),
  panelSecret('SMTP_USER', 'credentials', ['demo'], SECRET_FORMATS.plain, 'refresh'),
  panelSecret('SMTP_PASSWORD', 'credentials', ['demo'], SECRET_FORMATS.password, 'refresh'),
  // só no .env: não dá para guardar no banco a chave que abre o cofre, o login ou o próprio banco
  // o Prometheus manda o mesmo token lido do .env: trocar só no painel cortaria as métricas
  secret('METRICS_TOKEN', 'credentials', ['api']),
  // KEK dos segredos do painel (#1087): cada serviço que lê uma chave trocada no painel precisa dela
  secret('SETTINGS_KEK', 'credentials', ['ingestor', 'live', 'agents', 'api', 'demo']),
  // KEK dos webhooks: o worker não relata ao painel; a demo (cadastro no painel do cliente) relata se está definida
  secret('WEBHOOK_SIGNING_SECRET', 'credentials', ['demo']),
  secret('ADMIN_KEY_HASHES', 'credentials', ['api']),
  secret('GALAXIE_DEMO_KEY', 'credentials', ['demo']),
  secret('BETTER_AUTH_SECRET', 'credentials', ['demo']),
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export const isSecret = (def: SettingDef) => def.type === 'secret';

/** Segredo que o painel troca (cifrado no banco); os outros segredos ficam só no .env. */
export const isPanelSecret = (def: SettingDef | undefined): def is SettingDef =>
  def?.type === 'secret' && def.panelSecret === true;

/**
 * O serviço cujo relato vale para a chave no painel: o primeiro de `def.services` que a relatou (`reported` diz se
 * relatou), ou o primeiro da lista. Com o ao vivo no `ingestor` (SCHEDULER_LIVE=internal) o serviço `live` não relata,
 * e o valor mostrado é o do ingestor.
 */
export function reportedService(
  def: Pick<SettingDef, 'services'>,
  reported: (service: RuntimeService) => boolean,
): RuntimeService {
  return def.services.find(reported) ?? def.services[0]!;
}

/** Quando a mudança chega a cada serviço que lê a chave (`applyIn` por cima de `apply`). */
export function settingApply(
  def: Pick<SettingDef, 'apply' | 'applyIn'>,
  service: RuntimeService,
): SettingApply {
  return def.applyIn?.[service] ?? def.apply;
}

/** Os serviços que leem a chave agrupados por quando a mudança chega, na ordem refresh, next-run, restart. */
export function settingApplyGroups(
  def: Pick<SettingDef, 'apply' | 'applyIn' | 'services'>,
): { apply: SettingApply; services: RuntimeService[] }[] {
  return (['refresh', 'next-run', 'restart'] as const)
    .map((apply) => ({ apply, services: def.services.filter((svc) => settingApply(def, svc) === apply) }))
    .filter((g) => g.services.length > 0);
}

/** Flags que um serviço lê (incluindo segredos, para o relatório de "configurado"). */
export function settingsForService(service: RuntimeService): SettingDef[] {
  return SETTINGS.filter((s) => s.services.includes(service));
}

export function scheduledJob(name: string): ScheduledJobDef | undefined {
  return SCHEDULED_JOBS.find((j) => j.name === name);
}
