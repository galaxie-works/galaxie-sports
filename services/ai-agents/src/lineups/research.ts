/**
 * Pesquisa da grade de canais e ofertas (job `lineups-research`): por país, descobre as principais
 * operadoras de TV paga, vMVPDs, combos de telecom e streamings com esporte; para cada uma, levanta os
 * planos, os canais esportivos de cada plano e os streamings inclusos.
 *
 * Regras, no código e não no prompt:
 * - sem fonte, sem conteúdo: a fonte precisa ter vindo da busca do provedor (`groundedUrls` do Gemini
 *   em dois passos; nos outros provedores, as citações) e vir com o trecho. Item sem fonte não entra;
 * - nome ou domínio na blocklist editorial (config/broadcasters/_policy.yaml + WTW_BLOCKLIST_FILE/
 *   WTW_BLOCKLIST) descarta o item sem registrar o nome;
 * - canal e streaming precisam casar com uma entrada da biblioteca de emissoras (dicionário do país, no
 *   dia: canal extinto e apelido de antes da renomeação não casam); nome desconhecido fica de fora (e
 *   aparece no relatório para a curadoria);
 * - o validador determinístico (`validate.ts`) segue o redirecionamento do grounding, classifica a fonte
 *   pelo domínio final e confere o trecho: só fonte oficial e específica do plano vale para `included` e
 *   para o preço cheio; o resto entra como `unverified`;
 * - tudo vai como `draft` por `upsertLineupDraft` (idempotente; aprovado não volta a rascunho).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  platform as platformTable,
  platformPlan,
  platformSlug,
  recordPlanPagesExtraction,
  setPlatformPlanPages,
  touchPlatformLineup,
  upsertLineupDraft,
  proposeLineupChange,
  type Database,
  type LineupChange,
  type LineupPageContent,
  type LineupPlanDraft,
  type LineupPlatform,
  type PlatformKind,
} from '@galaxie/db';
import { hostOf, normalizeName, type CountryDirectory, type WtwConfig } from '@galaxie/where-to-watch';
import { detectPromptInjection, isAllowedUrl } from '../guardrails/index.js';
import type { UsageWithSearches } from '../llm/budget.js';
import { BudgetExceededError } from '../llm/errors.js';
import { sanitizeText } from '../llm/hygiene.js';
import { estimateCostUsd, GEMINI_GROUNDING_USD_PER_QUERY } from '../llm/pricing.js';
import type { LlmClient, LlmResult } from '../llm/types.js';
import { candidatePages } from './confirm.js';
import {
  extractedPlanNames,
  modelsFromExtraction,
  needsExtraction,
  pageLocator,
  pagesHash,
  pageVerifyContext,
  withPageRef,
  type ReadablePage,
} from './page-research.js';
import { contentHashOf, type OfficialPageReader, type PageRead } from './pages.js';
import {
  catalogPrompt,
  discoveryPrompt,
  lineupSystemPrompt,
  pageExtractPrompt,
  pageExtractSystemPrompt,
  planPagesPrompt,
  planPrompt,
} from './prompt.js';
import {
  acceptableOfficialDomain,
  amountsIn,
  isOfficialUrl,
  redirectResolver,
  spaced,
  verifyPlans,
  GRADE_CHANNEL_MEDIA,
  verifyAddons,
  type ModelPlan,
  type VerifyOutcome,
} from './validate.js';
import {
  LINEUP_DISCOVERY_SCHEMA,
  LINEUP_DISCOVERY_SCHEMA_NAME,
  LINEUP_MAX_CHANNELS,
  LINEUP_MAX_OFFICIAL_DOMAINS,
  LINEUP_MAX_PLAN_PAGES,
  LINEUP_MAX_PLANS,
  LINEUP_MAX_PLATFORMS,
  LINEUP_MAX_SERVICES,
  LINEUP_MAX_SOURCES,
  LINEUP_CATALOG_SCHEMA,
  LINEUP_CATALOG_SCHEMA_NAME,
  LINEUP_PAGE_EXTRACT_SCHEMA,
  LINEUP_PAGE_EXTRACT_SCHEMA_NAME,
  LINEUP_PLAN_PAGES_SCHEMA,
  LINEUP_PLAN_PAGES_SCHEMA_NAME,
  LINEUP_PLAN_SCHEMA,
  LINEUP_PLAN_SCHEMA_NAME,
  type LineupCatalogOutput,
  type LineupDiscoveryOutput,
  type LineupOutputSource,
  type LineupPageExtractOutput,
  type LineupPlanOutput,
  type LineupPlanPagesOutput,
} from './schema.js';

const DAY = 86_400_000;

/** Países do começo da grade. */
export const LINEUP_COUNTRIES = ['BR', 'AR', 'MX', 'CO', 'CL'] as const;
/** Itens vistos há mais que isto entram na revisita. */
export const LINEUP_STALE_DAYS = 30;

export const discoveryPurpose = (country: string) => `lineups:discover:${country}`;
export const plansPurpose = (slug: string, country: string) => `lineups:plans:${slug}:${country}`;
/** Etapa 1 (lista dos planos e catálogo de complementos) e etapa 2 (um plano). */
export const catalogPurpose = (slug: string, country: string) => `lineups:catalog:${slug}:${country}`;
export const planPurpose = (slug: string, country: string) => `lineups:plan:${slug}:${country}`;
/** Pela página oficial: a descoberta das URLs de planos (busca curta) e a extração (sem busca). */
export const planPagesPurpose = (slug: string, country: string) => `lineups:pages-url:${slug}:${country}`;
export const extractPurpose = (slug: string, country: string) => `lineups:extract:${slug}:${country}`;

/**
 * pages = lê a página oficial e extrai sem busca (padrão) · search = a pesquisa antiga, com grounding em
 * cada etapa (`--com-busca`, só para comparar ou quando o site não deixa ler).
 */
export type LineupResearchMode = 'pages' | 'search';

const searchesOf = (r: LlmResult<unknown>) => (r.usage as UsageWithSearches).webSearchCalls ?? 0;

/** Junta as fontes da busca de várias chamadas (as etapas de uma mesma plataforma). */
function mergeResults(
  results: readonly LlmResult<unknown>[],
): Pick<LlmResult<unknown>, 'groundedUrls' | 'citations'> {
  const grounded = results.flatMap((r) => r.groundedUrls ?? r.citations.map((c) => c.url));
  return { groundedUrls: [...new Set(grounded)], citations: [] };
}

// ─── fontes ancoradas ────────────────────────────────────────────────────────────────────────────

/** URL comparável (sem fragmento, barra final e caixa do host). */
export function comparableUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim();
  }
}

/**
 * URLs que vieram da busca do provedor: `groundedUrls` (Gemini em dois passos) ou, sem elas, as
 * citações. Devolve a URL real ancorada (ou null) para a URL escrita pelo modelo.
 */
export function anchorResolver(result: Pick<LlmResult<unknown>, 'groundedUrls' | 'citations'>) {
  const urls = result.groundedUrls ?? result.citations.map((c) => c.url);
  const byKey = new Map(urls.map((u) => [comparableUrl(u), u]));
  return (url: string | null | undefined): string | null =>
    url ? (byKey.get(comparableUrl(url)) ?? null) : null;
}

export interface DropStats {
  /** Itens sem fonte ancorada (ou sem trecho). */
  noSource: number;
  /** Bloqueados pela política editorial (nome nunca registrado). */
  blocked: number;
  /** Canais/streamings sem entrada na biblioteca (nomes para a curadoria). */
  unknown: string[];
  /** Canais/streamings fora do período no dicionário (extintos). */
  inactive: string[];
  /** Texto com padrão de prompt injection. */
  injection: number;
}

const emptyDrops = (): DropStats => ({ noSource: 0, blocked: 0, unknown: [], inactive: [], injection: 0 });

/** O que o validador aceitou numa pesquisa de planos. */
export interface VerificationStats {
  plans: number;
  /** Planos com preço cheio provado (fonte oficial e específica). */
  pricedPlans: number;
  included: number;
  addon: number;
  unverified: number;
  /** Fontes por nível (domínio final). */
  tiers: Record<string, number>;
  /** Ofertas do catálogo de complementos aceitas. */
  addons: number;
}

const emptyVerification = (): VerificationStats => ({
  plans: 0,
  pricedPlans: 0,
  included: 0,
  addon: 0,
  unverified: 0,
  tiers: {},
  addons: 0,
});

class SourceGate {
  constructor(
    private readonly anchor: (url: string | null | undefined) => string | null,
    private readonly dir: CountryDirectory,
  ) {}

  /** Fonte citável: ancorada na busca, http(s) e fora da blocklist (o nível dela é do validador). */
  cite(url: string | null | undefined): string | null {
    const real = this.anchor(url);
    if (!real || !isAllowedUrl(real)) return null;
    return this.dir.blocklist.isBlockedUrl(real) ? null : real;
  }

  /** Fonte aceitável para a descoberta: citável e não agregador. */
  accept(url: string | null | undefined): string | null {
    const real = this.cite(url);
    return real && !this.dir.isAggregator(real) ? real : null;
  }

  many(sources: readonly LineupOutputSource[], extra: (string | null)[] = []): string[] {
    const out: string[] = [];
    for (const u of [...sources.map((s) => s.url), ...extra]) {
      const ok = this.accept(u);
      if (ok && !out.includes(ok)) out.push(ok);
    }
    return out.slice(0, LINEUP_MAX_SOURCES);
  }
}

const cleanName = (s: string, max = 120) => sanitizeText(s, max).replace(/\s+/g, ' ').trim();

// ─── tarefas ─────────────────────────────────────────────────────────────────────────────────────

export type LineupTask =
  | { kind: 'discover'; country: string; reason: 'new_country' | 'rediscover' | 'revisit' }
  | {
      kind: 'plans';
      country: string;
      platformId: string;
      slug: string;
      name: string;
      reason: 'no_plans' | 'revisit' | 'requested';
    };

export interface PlanLineupOptions {
  countries: readonly string[];
  now: Date;
  /** Revisita: refaz os itens com `seen_at` mais velho que `staleDays`. */
  revisit?: boolean;
  staleDays?: number;
  /** Refaz a descoberta mesmo com plataformas já gravadas. */
  rediscover?: boolean;
  /** Só esta plataforma (slug). */
  platformSlug?: string;
}

/**
 * O que pesquisar por país. Sem revisita: descoberta onde não há plataformas, e planos das
 * plataformas sem plano (com `rediscover`, a descoberta e os planos de todas). Com revisita:
 * descoberta e planos dos itens vistos há mais de `staleDays`.
 */
export async function planLineupResearch(db: Database, opts: PlanLineupOptions): Promise<LineupTask[]> {
  const cutoff = new Date(opts.now.getTime() - (opts.staleDays ?? LINEUP_STALE_DAYS) * DAY);
  const countries = [...new Set(opts.countries.map((c) => c.toUpperCase()))];
  if (!countries.length) return [];
  const rows = await db
    .select({
      id: platformTable.id,
      slug: platformTable.slug,
      name: platformTable.name,
      country: platformTable.country,
      seenAt: platformTable.seenAt,
    })
    .from(platformTable)
    .where(and(inArray(platformTable.country, countries), ne(platformTable.reviewStatus, 'rejected')));
  const stats = rows.length
    ? await db
        .select({
          platformId: platformPlan.platformId,
          // plano rejeitado não conta: a plataforma só com rejeitados volta a ser pesquisada
          plans: sql<number>`(count(*) filter (where ${platformPlan.reviewStatus} <> 'rejected'))::int`,
          oldestPlan: sql<
            string | null
            // plano que a revisita já marcou como não visto espera o painel, não outra pesquisa
          >`min(${platformPlan.seenAt}) filter (where ${platformPlan.reviewStatus} <> 'rejected' and coalesce((${platformPlan.proposedChange}->>'removed')::boolean, false) = false)`,
        })
        .from(platformPlan)
        .where(
          inArray(
            platformPlan.platformId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(platformPlan.platformId)
    : [];
  const byPlatform = new Map(stats.map((s) => [s.platformId, s]));
  const platforms = rows.map((r) => ({
    ...r,
    plans: byPlatform.get(r.id)?.plans ?? 0,
    oldestPlan: byPlatform.get(r.id)?.oldestPlan ?? null,
  }));
  const tasks: LineupTask[] = [];
  for (const country of countries) {
    const mine = platforms
      .filter((p) => p.country === country)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (opts.platformSlug) {
      for (const p of mine.filter((p) => p.slug === opts.platformSlug))
        tasks.push({
          kind: 'plans',
          country,
          platformId: p.id,
          slug: p.slug,
          name: p.name,
          reason: 'requested',
        });
      continue;
    }
    if (opts.revisit) {
      const newest = Math.max(0, ...mine.map((p) => new Date(p.seenAt).getTime()));
      if (mine.length && newest < cutoff.getTime())
        tasks.push({ kind: 'discover', country, reason: 'revisit' });
      for (const p of mine) {
        const oldest = p.oldestPlan ? new Date(p.oldestPlan) : p.plans ? null : new Date(p.seenAt);
        if (oldest && oldest < cutoff)
          tasks.push({
            kind: 'plans',
            country,
            platformId: p.id,
            slug: p.slug,
            name: p.name,
            reason: 'revisit',
          });
      }
      continue;
    }
    if (!mine.length || opts.rediscover)
      tasks.push({ kind: 'discover', country, reason: mine.length ? 'rediscover' : 'new_country' });
    // --redescobrir refaz também as páginas de planos: entra toda plataforma, não só a sem plano
    for (const p of opts.rediscover ? mine : mine.filter((p) => p.plans === 0))
      tasks.push({
        kind: 'plans',
        country,
        platformId: p.id,
        slug: p.slug,
        name: p.name,
        reason: p.plans === 0 ? 'no_plans' : 'requested',
      });
  }
  return tasks;
}

// ─── estimativa (--plan, sem LLM) ────────────────────────────────────────────────────────────────

/** Medido na produção (ops.llm_usage, 7 dias até 25/10/2026): 873 buscas em 83 chamadas com grounding. */
export const GROUNDED_SEARCHES_PER_CALL = 10.5;
/** A descoberta das páginas de planos pede no máximo 3 buscas. */
export const PLAN_PAGES_SEARCHES = 3;
/** Planos por plataforma na pesquisa antiga, quando a plataforma ainda não tem planos gravados. */
const SEARCH_MODE_PLANS = 4;

export interface LineupModels {
  research: string;
  light: string;
}

export interface LineupCallEstimate {
  task: LineupTask;
  /** Chamadas com busca (descoberta, URLs de planos ou a pesquisa antiga) e as buscas esperadas. */
  searchCalls: number;
  searches: number;
  /** Extrações sem busca (teto: na execução, 0 se a página não mudou). */
  extractCalls: number;
  usd: number;
  note: string | null;
}

const tokensUsd = (model: string, inputTokens: number, outputTokens: number) =>
  estimateCostUsd(model, { inputTokens, outputTokens }) ?? 0;

/** Uma chamada com busca: pesquisa no modelo de pesquisa + estruturação no leve, e as buscas. */
export const groundedCallUsd = (m: LineupModels, searches: number) =>
  tokensUsd(m.research, 4_000, 1_500) +
  tokensUsd(m.light, 6_000, 1_500) +
  searches * GEMINI_GROUNDING_USD_PER_QUERY;
/** Uma extração sem busca: as páginas no prompt (~30 mil tokens) e a grade na saída. */
export const extractCallUsd = (m: LineupModels) => tokensUsd(m.light, 30_000, 4_000);

/**
 * O que cada tarefa deve chamar (sem LLM nem rede): na pesquisa pela página, uma busca curta só para a
 * plataforma sem página de planos conhecida e no máximo uma extração (nenhuma se a página não mudou).
 */
export async function estimateLineupCalls(
  db: Database,
  tasks: readonly LineupTask[],
  opts: { mode: LineupResearchMode; models: LineupModels; rediscover?: boolean },
): Promise<LineupCallEstimate[]> {
  const ids = tasks.flatMap((t) => (t.kind === 'plans' ? [t.platformId] : []));
  const platforms = ids.length
    ? await db.select().from(platformTable).where(inArray(platformTable.id, ids))
    : [];
  const plans = ids.length
    ? await db
        .select({
          platformId: platformPlan.platformId,
          url: platformPlan.url,
          sources: platformPlan.sources,
          verification: platformPlan.verification,
        })
        .from(platformPlan)
        .where(and(inArray(platformPlan.platformId, ids), ne(platformPlan.reviewStatus, 'rejected')))
    : [];
  const grounded = (calls: number, searches: number) => ({
    searchCalls: calls,
    searches,
    extractCalls: 0,
    usd: calls ? calls * groundedCallUsd(opts.models, searches / calls) : 0,
    note: null,
  });
  return tasks.map((task): LineupCallEstimate => {
    if (task.kind === 'discover') return { task, ...grounded(1, GROUNDED_SEARCHES_PER_CALL) };
    const row = platforms.find((p) => p.id === task.platformId);
    const mine = plans.filter((p) => p.platformId === task.platformId);
    if (opts.mode === 'search') {
      const calls = 1 + (mine.length || SEARCH_MODE_PLANS);
      return { task, ...grounded(calls, calls * GROUNDED_SEARCHES_PER_CALL) };
    }
    if (!row || (!row.website && !row.officialDomains.length))
      return { task, ...grounded(0, 0), note: 'sem site oficial: nada a ler' };
    const known = !opts.rediscover && (row.planPages.length > 0 || candidatePages(row, mine, 1).length > 0);
    const search = known ? grounded(0, 0) : grounded(1, PLAN_PAGES_SEARCHES);
    return {
      task,
      ...search,
      extractCalls: 1,
      usd: search.usd + extractCallUsd(opts.models),
      note: known
        ? row.planPagesHash
          ? 'página guardada; extrai só se mudou'
          : 'página guardada; primeira extração'
        : 'sem página de planos guardada: busca curta',
    };
  });
}

// ─── execução ────────────────────────────────────────────────────────────────────────────────────

export interface LineupCallOutcome {
  task: LineupTask;
  status: 'done' | 'failed' | 'skipped';
  /** Plataformas (descoberta) ou planos (pesquisa de planos) aceitos com fonte. */
  accepted: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  changes: LineupChange[];
  drops: DropStats;
  /** Pesquisa de planos: o que passou no validador. */
  verification: VerificationStats;
  costUsd: number | null;
  /** Plataformas novas da descoberta (para pesquisar os planos em seguida). */
  newPlatforms: { id: string; slug: string; name: string }[];
  /** Chamadas de LLM feitas (a pesquisa de planos faz uma por etapa e por plano). */
  calls: number;
  /** Planos listados na etapa 1 que não voltaram com detalhe na etapa 2. */
  missingPlans: string[];
  /** Planos listados sem orçamento para o detalhe nesta execução. */
  skippedPlans: string[];
  /** Domínio novo do site oficial (rebrand), quando o site redireciona. */
  rebrandTo: string | null;
  /** Buscas na web feitas pelo provedor nesta tarefa (o mesmo que vai para ops.llm_usage). */
  searches: number;
  /** Chamadas com busca (descoberta, URLs de planos, pesquisa antiga) e sem busca (extração). */
  searchCalls: number;
  extractCalls: number;
  /** Pela página oficial: as páginas lidas. */
  pages: Pick<PageRead, 'url' | 'status' | 'via' | 'fromCache' | 'hashChanged' | 'error'>[];
  /** Pela página oficial: a página não mudou desde a última extração (nenhuma chamada ao modelo). */
  pagesUnchanged: boolean;
  /** Por que a tarefa parou antes de extrair (sem site, nenhuma página lida, sem orçamento). */
  note: string | null;
  error?: string;
}

export interface LineupResearchDeps {
  db: Database;
  llm: LlmClient;
  config: WtwConfig;
  now?: () => Date;
  log?: (m: string) => void;
  /** URL citada → URL final (segue o redirecionamento do grounding). Padrão: `redirectResolver()`. */
  resolveUrl?: (url: string) => Promise<string | null>;
  /** Leitor educado do site oficial (rebrand: o site que redireciona para outro domínio). */
  pages?: OfficialPageReader | null;
}

export interface LineupRunOptions extends Omit<PlanLineupOptions, 'now'> {
  /** Máximo de chamadas ao modelo (com e sem busca) nesta execução. */
  maxCalls: number;
  /** Padrão `pages`: lê a página oficial e extrai sem busca. */
  mode?: LineupResearchMode;
  /** Pela página oficial: ignora o cache das páginas e extrai mesmo com a página igual. */
  force?: boolean;
}

const STREAMING_MEDIA = new Set(['streaming_svod', 'streaming_free']);

export class LineupResearcher {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly resolveUrl: (url: string) => Promise<string | null>;

  constructor(private readonly deps: LineupResearchDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
    this.resolveUrl = deps.resolveUrl ?? redirectResolver();
  }

  private directory(country: string): CountryDirectory {
    return this.deps.config.directory(country);
  }

  /** Executa as pesquisas pendentes até `maxCalls`; plataforma recém-descoberta já entra na fila. */
  async run(opts: LineupRunOptions): Promise<LineupCallOutcome[]> {
    const out: LineupCallOutcome[] = [];
    let calls = 0;
    for (const country of opts.countries) {
      if (!this.deps.config.has(country)) {
        this.log(`${country}: sem dicionário de emissoras; pulado.`);
        continue;
      }
      const queue = await planLineupResearch(this.deps.db, {
        ...opts,
        countries: [country],
        now: this.now(),
      });
      while (queue.length) {
        if (calls >= opts.maxCalls) return out;
        const task = queue.shift()!;
        const outcome =
          task.kind === 'discover'
            ? await this.discover(task)
            : (opts.mode ?? 'pages') === 'search'
              ? await this.researchPlans(task, opts.maxCalls - calls)
              : await this.researchFromPages(task, opts.maxCalls - calls, {
                  force: opts.force ?? false,
                  rediscoverPages: opts.rediscover ?? false,
                });
        // página igual à da última extração não chama o modelo e não gasta o --max
        calls += outcome.calls;
        out.push(outcome);
        if (outcome.status === 'skipped') return out; // orçamento do dia esgotado
        // plataforma nova entra na fila também na revisita (senão só volta quando ficar velha)
        if (task.kind === 'discover')
          for (const p of outcome.newPlatforms)
            queue.push({
              kind: 'plans',
              country,
              platformId: p.id,
              slug: p.slug,
              name: p.name,
              reason: 'no_plans',
            });
      }
    }
    return out;
  }

  private base(task: LineupTask): LineupCallOutcome {
    return {
      task,
      status: 'done',
      accepted: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      changes: [],
      drops: emptyDrops(),
      verification: emptyVerification(),
      costUsd: null,
      newPlatforms: [],
      calls: 0,
      missingPlans: [],
      skippedPlans: [],
      rebrandTo: null,
      searches: 0,
      searchCalls: 0,
      extractCalls: 0,
      pages: [],
      pagesUnchanged: false,
      note: null,
    };
  }

  /** Soma o custo, as buscas e a chamada no resultado da tarefa. */
  private count(out: LineupCallOutcome, r: LlmResult<unknown>, kind: 'search' | 'extract'): void {
    out.calls++;
    if (kind === 'search') out.searchCalls++;
    else out.extractCalls++;
    out.searches += searchesOf(r);
    if (r.usage.costUsd !== undefined) out.costUsd = (out.costUsd ?? 0) + r.usage.costUsd;
  }

  private failed(out: LineupCallOutcome, err: unknown): LineupCallOutcome {
    const partial = (err as { usage?: { costUsd?: number } }).usage;
    return {
      ...out,
      status: err instanceof BudgetExceededError ? 'skipped' : 'failed',
      costUsd: partial?.costUsd ?? out.costUsd,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }

  /** Descoberta: as principais plataformas do país, cada uma com fonte. */
  async discover(task: Extract<LineupTask, { kind: 'discover' }>): Promise<LineupCallOutcome> {
    const { db } = this.deps;
    const out = this.base(task);
    const dir = this.directory(task.country);
    const existing = await db.select().from(platformTable).where(eq(platformTable.country, task.country));
    try {
      const res = await this.deps.llm.generateJson<LineupDiscoveryOutput>({
        tier: 'research',
        system: lineupSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: discoveryPrompt({
              country: task.country,
              known: existing.filter((p) => p.reviewStatus !== 'rejected').map((p) => p.name),
            }),
          },
        ],
        schema: LINEUP_DISCOVERY_SCHEMA,
        schemaName: LINEUP_DISCOVERY_SCHEMA_NAME,
        webSearch: true,
        maxOutputTokens: 8_000,
        purpose: discoveryPurpose(task.country),
      });
      this.count(out, res, 'search');
      const gate = new SourceGate(anchorResolver(res), dir);
      const seenAt = this.now();
      const seen = new Set<string>();
      // rebrand: plataforma já gravada cujo site passou a redirecionar para outro domínio
      if (this.deps.pages)
        for (const p of existing.filter((p) => p.website && p.reviewStatus !== 'rejected')) {
          const target = await this.deps.pages.rebrandTarget(p.website!);
          if (
            target &&
            (await proposeLineupChange(
              db,
              { type: 'platform', id: p.id },
              {
                website: target,
                note: `o site oficial (${hostOf(p.website!)}) redireciona para ${hostOf(target)}`,
              },
              seenAt,
            ))
          )
            out.changes.push({ target: { type: 'platform', id: p.id }, fields: ['website'] });
        }
      for (const p of res.data.platforms.slice(0, LINEUP_MAX_PLATFORMS)) {
        const name = cleanName(p.name);
        if (!name || seen.has(normalizeName(name))) continue;
        seen.add(normalizeName(name));
        const site = p.website && isAllowedUrl(p.website) ? p.website.trim() : null;
        // site que é de comparador, imprensa ou rede social não é o oficial
        const website = site && acceptableOfficialDomain(hostOf(site) ?? '', dir) ? site : null;
        const officialDomains = (p.dominios_oficiais ?? [])
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d && acceptableOfficialDomain(d, dir))
          .slice(0, LINEUP_MAX_OFFICIAL_DOMAINS);
        if (dir.blocklist.isBlockedName(name) || (website && dir.blocklist.isBlockedUrl(website))) {
          out.drops.blocked++;
          continue;
        }
        if (detectPromptInjection(name).length) {
          out.drops.injection++;
          continue;
        }
        const sources = gate.many(p.sources);
        if (!sources.length) {
          out.drops.noSource++;
          continue;
        }
        const match = matchExisting(existing, task.country, name, website);
        if (match?.reviewStatus === 'rejected') continue;
        const r = await upsertLineupDraft(db, {
          platform: {
            slug: match?.slug ?? platformSlug(task.country, name),
            name: match?.name ?? name,
            kind: match?.kind ?? p.kind,
            country: task.country,
            website: match?.website ?? website,
            officialDomains,
            broadcasterId: match?.broadcasterId ?? streamingId(dir, name, match?.kind ?? p.kind),
            sources,
          },
          seenAt,
        });
        out.accepted++;
        this.add(out, r);
        if (!match && r.created) {
          const slug = platformSlug(task.country, name);
          out.newPlatforms.push({ id: r.platformId, slug, name });
          existing.push({ ...(await this.platformRow(r.platformId)) });
        }
      }
      this.log(
        `${task.country}: descoberta · ${out.accepted} plataforma(s) com fonte` +
          ` (${out.newPlatforms.length} nova(s)) · descartadas: ${out.drops.noSource} sem fonte, ${out.drops.blocked} pela política`,
      );
      return out;
    } catch (err) {
      return this.failed(out, err);
    }
  }

  private async platformRow(id: string): Promise<LineupPlatform> {
    const [row] = await this.deps.db.select().from(platformTable).where(eq(platformTable.id, id));
    return row!;
  }

  /** Rebrand: na revisita, o site oficial que passou a redirecionar para outro domínio vira mudança. */
  private async checkRebrand(
    task: Extract<LineupTask, { kind: 'plans' }>,
    row: LineupPlatform,
    out: LineupCallOutcome,
  ): Promise<void> {
    if (task.reason !== 'revisit' || !row.website || !this.deps.pages) return;
    const target = await this.deps.pages.rebrandTarget(row.website);
    if (!target) return;
    out.rebrandTo = target;
    await proposeLineupChange(
      this.deps.db,
      { type: 'platform', id: row.id },
      {
        website: target,
        note: `o site oficial (${hostOf(row.website)}) redireciona para ${hostOf(target)}`,
      },
      this.now(),
    );
  }

  /** Nomes da biblioteca do país para o prompt (o modelo repete a mesma grafia). */
  private libraryNames(dir: CountryDirectory): { channels: string[]; services: string[] } {
    return {
      channels: dir.broadcasters
        .filter((b) => GRADE_CHANNEL_MEDIA.has(b.medium))
        .flatMap((b) => [b.name, ...b.channels]),
      services: dir.broadcasters.filter((b) => STREAMING_MEDIA.has(b.medium)).map((b) => b.name),
    };
  }

  /**
   * As URLs das páginas de planos de uma plataforma sem nenhuma conhecida: uma chamada curta com busca
   * no site oficial. Vale a URL do domínio oficial (a leitura confere de novo e respeita o robots.txt).
   */
  private async findPlanPages(
    task: Extract<LineupTask, { kind: 'plans' }>,
    row: LineupPlatform,
    out: LineupCallOutcome,
  ): Promise<string[]> {
    const officialHosts = [row.website ? hostOf(row.website) : null, ...row.officialDomains].filter(
      (d): d is string => !!d,
    );
    const res = await this.deps.llm.generateJson<LineupPlanPagesOutput>({
      tier: 'research',
      system: lineupSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: planPagesPrompt({
            country: task.country,
            platform: {
              name: row.name,
              kind: row.kind,
              website: row.website,
              officialDomains: row.officialDomains,
            },
          }),
        },
      ],
      schema: LINEUP_PLAN_PAGES_SCHEMA,
      schemaName: LINEUP_PLAN_PAGES_SCHEMA_NAME,
      webSearch: true,
      ...(officialHosts.length ? { allowedDomains: officialHosts } : {}),
      maxOutputTokens: 2_000,
      purpose: planPagesPurpose(row.slug, task.country),
    });
    this.count(out, res, 'search');
    const anchor = anchorResolver(res);
    const dir = this.directory(task.country);
    const urls: { url: string; grounded: boolean }[] = [];
    for (const p of res.data.paginas) {
      const grounded = anchor(p.url);
      const raw = grounded ?? (isAllowedUrl(p.url) ? p.url.trim() : null);
      const url = raw ? await this.resolveUrl(raw) : null;
      if (!url || !isOfficialUrl(url, row) || dir.blocklist.isBlockedUrl(url)) continue;
      const key = comparableUrl(url);
      if (!urls.some((u) => comparableUrl(u.url) === key)) urls.push({ url, grounded: !!grounded });
    }
    // as que vieram da busca primeiro
    return [...urls.filter((u) => u.grounded), ...urls.filter((u) => !u.grounded)]
      .map((u) => u.url)
      .slice(0, LINEUP_MAX_PLAN_PAGES);
  }

  /**
   * Planos de uma plataforma pela página oficial (padrão): URLs guardadas (ou uma busca curta para
   * achá-las), leitura do nosso lado, e uma extração sem busca só quando a página mudou desde a última.
   * `budget`: chamadas ao modelo que esta tarefa ainda pode fazer.
   */
  async researchFromPages(
    task: Extract<LineupTask, { kind: 'plans' }>,
    budget = Infinity,
    opts: { force?: boolean; rediscoverPages?: boolean } = {},
  ): Promise<LineupCallOutcome> {
    const { db, llm } = this.deps;
    const out = this.base(task);
    const reader = this.deps.pages;
    if (!reader) return { ...out, status: 'failed', error: 'sem leitor da página oficial' };
    const row = await this.platformRow(task.platformId);
    if (!row) return { ...out, status: 'failed', error: 'plataforma inexistente' };
    const dir = this.directory(task.country);
    const stop = (note: string) => {
      out.note = note;
      this.log(`${row.slug}: ${note}`);
      return out;
    };
    if (!row.website && !row.officialDomains.length)
      return stop(
        'sem site oficial: a página de planos não tem onde ser lida (corrija a plataforma no painel)',
      );
    try {
      await this.checkRebrand(task, row, out);
      const known = await db
        .select({
          name: platformPlan.name,
          url: platformPlan.url,
          sources: platformPlan.sources,
          verification: platformPlan.verification,
        })
        .from(platformPlan)
        .where(and(eq(platformPlan.platformId, row.id), ne(platformPlan.reviewStatus, 'rejected')));

      // 1. as páginas de planos: guardadas, as oficiais dos planos já gravados ou uma busca curta
      let urls = opts.rediscoverPages
        ? []
        : row.planPages.length
          ? row.planPages
          : candidatePages(row, known, LINEUP_MAX_PLAN_PAGES);
      if (!urls.length) urls = await this.findPlanPages(task, row, out);
      if (!urls.length && row.website) urls = [row.website];

      // 2. leitura do nosso lado (cache por URL; estático → JSON embutido → navegador)
      const enough = enoughForExtraction(dir, row.kind);
      const reads: ReadablePage[] = [];
      for (const url of urls.slice(0, LINEUP_MAX_PLAN_PAGES)) {
        const read = await reader.read(url, row, { platformId: row.id, force: opts.force ?? false, enough });
        out.pages.push({
          url,
          status: read.status,
          via: read.via,
          fromCache: read.fromCache,
          hashChanged: read.hashChanged,
          ...(read.error ? { error: read.error } : {}),
        });
        // sem navegador, a página que pede JavaScript ainda pode ter os planos e os preços no estático
        if ((read.status === 'ok' || read.status === 'needs_render') && read.content?.text)
          reads.push({
            url: read.finalUrl ?? read.url,
            content: read.content,
            hash: read.hash ?? contentHashOf(read.content),
            via: read.via,
            fetchedAt: read.fetchedAt,
          });
      }
      // guarda as URLs certas (as que existem no site oficial), lidas ou não (robots, bloqueio)
      const keep = out.pages
        .filter((p) => p.status !== 'error' && p.status !== 'off_domain')
        .map((p) => p.url);
      if (keep.length && keep.join('\n') !== row.planPages.join('\n'))
        await setPlatformPlanPages(db, row.id, keep);
      if (!reads.length)
        return stop(
          `nenhuma página de planos lida (${out.pages.map((p) => `${p.status} ${p.url}`).join('; ') || 'nenhuma URL'})`,
        );

      // 3. página igual à da última extração: nada a extrair
      const hash = pagesHash(reads);
      if (!needsExtraction(row.planPagesHash, hash, opts.force)) {
        out.pagesUnchanged = true;
        await touchPlatformLineup(db, row.id, this.now());
        return stop('página de planos igual à da última extração; nenhuma chamada ao modelo');
      }
      if (out.calls >= budget)
        return stop('sem orçamento para a extração nesta execução; fica para a próxima');

      // 4. extração do texto, sem busca, no nível leve
      const lib = this.libraryNames(dir);
      const res = await llm.generateJson<LineupPageExtractOutput>({
        tier: 'light',
        system: pageExtractSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: pageExtractPrompt({
              country: task.country,
              platform: { name: row.name, kind: row.kind, website: row.website },
              pages: reads.map((r) => ({ url: r.url, text: r.content.text, sections: r.content.sections })),
              knownPlans: known.map((k) => k.name),
              channels: lib.channels,
              services: [...lib.services, ...lib.channels],
            }),
          },
        ],
        schema: LINEUP_PAGE_EXTRACT_SCHEMA,
        schemaName: LINEUP_PAGE_EXTRACT_SCHEMA_NAME,
        webSearch: false,
        maxOutputTokens: 16_000,
        purpose: extractPurpose(row.slug, task.country),
      });
      this.count(out, res, 'extract');

      // 5. o validador decide a prova; o trecho precisa estar na página
      const skip = (name: string) => {
        if (dir.blocklist.isBlockedName(name)) return (out.drops.blocked++, true);
        if (detectPromptInjection(name).length) return (out.drops.injection++, true);
        return false;
      };
      const names = extractedPlanNames(res.data);
      const locator = pageLocator(reads, names, row.name);
      const models = modelsFromExtraction(res.data, { pages: reads, locator, platformName: row.name, skip });
      const ctx = pageVerifyContext({
        country: row.country,
        platform: { name: row.name, website: row.website, officialDomains: row.officialDomains },
        dir,
        pages: reads,
        locator,
        now: this.now(),
      });
      const verified = await verifyPlans(models.plans, ctx);
      this.tally(out, verified);
      const catalog = await verifyAddons(models.addons, ctx);
      out.verification.addons = catalog.addons.length;
      for (const d of catalog.drops)
        if (d.reason === 'unknown' && !out.drops.unknown.includes(d.name)) out.drops.unknown.push(d.name);

      const plans: LineupPlanDraft[] = verified.plans.map((p) => ({
        name: p.name,
        priceText: p.priceText,
        priceAmount: p.priceAmount,
        priceCurrency: p.priceCurrency,
        url: p.url,
        sources: p.sources.slice(0, LINEUP_MAX_SOURCES),
        verification: withPageRef(p.verification, reads),
        channels: p.channels.map((c) => ({
          channelId: c.entryId,
          access: c.access,
          sources: c.sources.slice(0, LINEUP_MAX_SOURCES),
          verification: withPageRef(c.verification, reads),
        })),
        services: p.services.map((c) => ({
          serviceId: c.entryId,
          access: c.access,
          sources: c.sources.slice(0, LINEUP_MAX_SOURCES),
          verification: withPageRef(c.verification, reads),
        })),
      }));
      out.accepted = plans.length;
      // grade completa só com todas as páginas lidas por inteiro: página que falhou não apaga plano
      const allRead = out.pages.every((p) => p.status === 'ok');
      if (plans.length || catalog.addons.length) {
        const r = await upsertLineupDraft(db, {
          platform: {
            slug: row.slug,
            name: row.name,
            kind: row.kind,
            country: row.country,
            website: row.website,
            broadcasterId: row.broadcasterId,
            sources: row.sources,
          },
          plans,
          addons: catalog.addons.map((a) => ({
            ...a,
            url: null,
            verification: withPageRef(a.verification, reads),
          })),
          addonsComplete: task.reason === 'revisit' && allRead && catalog.addons.length > 0,
          seenAt: this.now(),
          complete: task.reason === 'revisit' && allRead && plans.length > 0,
        });
        this.add(out, r);
      }
      await recordPlanPagesExtraction(db, row.id, hash, this.now());
      const v = out.verification;
      this.log(
        `${row.slug}: ${reads.length} página(s) lida(s) · ${plans.length} plano(s) (${v.pricedPlans} com preço provado) · ` +
          `canais e streamings: ${v.included} incluso(s), ${v.addon} adicional(is), ${v.unverified} sem prova · ` +
          `${v.addons} complemento(s) · ${out.created} novo(s), ${out.changes.length} mudança(s) · ` +
          `${out.searchCalls} chamada(s) com busca (${out.searches} busca(s)), ${out.extractCalls} extração(ões)` +
          (out.drops.unknown.length ? ` · fora da biblioteca: ${out.drops.unknown.length}` : '') +
          (out.drops.inactive.length ? ` · extintos: ${out.drops.inactive.join(', ')}` : ''),
      );
      return out;
    } catch (err) {
      return this.failed(out, err);
    }
  }

  /**
   * Planos de uma plataforma em duas etapas: (1) a lista dos planos (só nome e fonte) e o catálogo de
   * complementos; (2) uma chamada por plano, para o detalhe. A validação é conjunta (o trecho
   * reaproveitado entre planos aparece) e o plano listado sem detalhe é acusado como faltando.
   * `budget`: chamadas que esta tarefa ainda pode fazer.
   */
  async researchPlans(
    task: Extract<LineupTask, { kind: 'plans' }>,
    budget = Infinity,
  ): Promise<LineupCallOutcome> {
    const { db, llm } = this.deps;
    const out = this.base(task);
    const dir = this.directory(task.country);
    const row = await this.platformRow(task.platformId);
    if (!row) return { ...out, status: 'failed', error: 'plataforma inexistente' };
    const known = await db
      .select({ name: platformPlan.name })
      .from(platformPlan)
      .where(and(eq(platformPlan.platformId, row.id), ne(platformPlan.reviewStatus, 'rejected')));
    const channelNames = dir.broadcasters
      .filter((b) => GRADE_CHANNEL_MEDIA.has(b.medium))
      .flatMap((b) => [b.name, ...b.channels]);
    const serviceNames = dir.broadcasters.filter((b) => STREAMING_MEDIA.has(b.medium)).map((b) => b.name);
    const platformInput = {
      name: row.name,
      kind: row.kind,
      website: row.website,
      officialDomains: row.officialDomains,
    };
    // a busca mira o site da plataforma: só a fonte oficial prova o plano
    const officialHosts = [row.website ? hostOf(row.website) : null, ...row.officialDomains].filter(
      (d): d is string => !!d,
    );
    const ask = <T>(content: string, schema: Record<string, unknown>, schemaName: string, purpose: string) =>
      llm.generateJson<T>({
        tier: 'research',
        system: lineupSystemPrompt(),
        messages: [{ role: 'user', content }],
        schema,
        schemaName,
        webSearch: true,
        ...(officialHosts.length ? { allowedDomains: officialHosts } : {}),
        maxOutputTokens: 12_000,
        purpose,
      });
    const cost = (r: LlmResult<unknown>) => this.count(out, r, 'search');

    await this.checkRebrand(task, row, out);

    const results: LlmResult<unknown>[] = [];
    try {
      // etapa 1: a lista dos planos e o catálogo de complementos
      const cat = await ask<LineupCatalogOutput>(
        catalogPrompt({
          country: task.country,
          platform: platformInput,
          knownPlans: known.map((k) => k.name),
          services: [...serviceNames, ...channelNames],
        }),
        LINEUP_CATALOG_SCHEMA,
        LINEUP_CATALOG_SCHEMA_NAME,
        catalogPurpose(row.slug, task.country),
      );
      cost(cat);
      results.push(cat);
      const listed: {
        name: string;
        url: string | null;
        evidence: { url: string | null; excerpt: string | null };
      }[] = [];
      for (const p of cat.data.planos) {
        const name = cleanName(p.plano_nome, 160);
        if (!name || listed.some((l) => normalizeName(l.name) === normalizeName(name))) continue;
        if (dir.blocklist.isBlockedName(name)) {
          out.drops.blocked++;
          continue;
        }
        if (detectPromptInjection(name).length) {
          out.drops.injection++;
          continue;
        }
        // sem fonte, sem conteúdo: plano listado só da memória nem vai para a 2ª etapa
        if (!p.fonte_url) {
          out.drops.noSource++;
          continue;
        }
        listed.push({ name, url: p.plano_url, evidence: { url: p.fonte_url, excerpt: p.trecho } });
      }

      // etapa 2: uma chamada por plano, dentro do orçamento
      const details = new Map<
        string,
        { status: 'ok' | 'not_found' | 'failed' | 'skipped'; data?: LineupPlanOutput }
      >();
      for (const l of listed.slice(0, LINEUP_MAX_PLANS)) {
        if (out.calls >= budget) {
          details.set(l.name, { status: 'skipped' });
          continue;
        }
        try {
          const r = await ask<LineupPlanOutput>(
            planPrompt({
              country: task.country,
              platform: platformInput,
              plan: l.name,
              siblings: listed.filter((x) => x !== l).map((x) => x.name),
              channels: channelNames,
              services: serviceNames,
            }),
            LINEUP_PLAN_SCHEMA,
            LINEUP_PLAN_SCHEMA_NAME,
            planPurpose(row.slug, task.country),
          );
          cost(r);
          results.push(r);
          details.set(l.name, { status: r.data.encontrado ? 'ok' : 'not_found', data: r.data });
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          details.set(l.name, { status: 'failed' });
          this.log(
            `${row.slug} · ${l.name}: detalhe falhou (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }

      // validação conjunta (as fontes valem se vieram de qualquer uma das buscas desta plataforma)
      const gate = new SourceGate(anchorResolver(mergeResults(results)), dir);
      const models: ModelPlan[] = listed.slice(0, LINEUP_MAX_PLANS).map((l) => {
        const d = details.get(l.name);
        const data = d?.status === 'ok' ? d.data! : null;
        return {
          name: l.name,
          priceAmount: null,
          currency: null,
          prices: (data?.precos ?? [])
            .filter((p) => typeof p.preco_mensal === 'number' && p.preco_mensal > 0)
            .map((p) => ({
              amount: p.preco_mensal,
              currency: p.moeda_iso?.trim().toUpperCase() || null,
              date: p.data_da_fonte,
              evidence: { url: p.fonte_url, excerpt: p.trecho },
            })),
          planUrl: data?.plano_url ?? l.url,
          evidence:
            data?.fonte_url && data.trecho_da_fonte
              ? { url: data.fonte_url, excerpt: data.trecho_da_fonte }
              : l.evidence,
          channels: (data?.canais ?? []).slice(0, LINEUP_MAX_CHANNELS).map((c) => ({
            name: cleanName(c.canal_nome),
            evidence: { url: c.fonte_url, excerpt: c.trecho },
          })),
          services: (data?.streamings_inclusos ?? []).slice(0, LINEUP_MAX_SERVICES).map((c) => ({
            name: cleanName(c.streaming_id),
            evidence: { url: c.fonte_url, excerpt: c.trecho },
          })),
        };
      });
      const ctx = {
        country: row.country,
        platform: { name: row.name, website: row.website, officialDomains: row.officialDomains },
        dir,
        resolveUrl: this.resolveUrl,
        acceptUrl: (u: string | null) => gate.cite(u),
        now: this.now(),
      };
      const verified = await verifyPlans(models, ctx);
      for (const p of verified.plans) {
        const st = details.get(p.name)?.status;
        p.verification.checks.details = st === 'ok' ? 'pass' : st === 'skipped' ? 'skip' : 'fail';
        if (p.verification.checks.details === 'fail') p.verification.verified = false;
        if (st === 'not_found' || st === 'failed') out.missingPlans.push(p.name);
        if (st === 'skipped') out.skippedPlans.push(p.name);
      }
      this.tally(out, verified);

      const catalog = await verifyAddons(
        cat.data.complementos.map((a) => ({
          name: cleanName(a.nome, 160),
          kind: a.tipo === 'canal' ? ('channel' as const) : ('service' as const),
          amount: typeof a.preco_mensal === 'number' && a.preco_mensal > 0 ? a.preco_mensal : null,
          currency: a.moeda_iso?.trim().toUpperCase() || null,
          commitmentMonths: a.fidelidade_meses,
          evidence: { url: a.fonte_url, excerpt: a.trecho },
        })),
        ctx,
      );
      out.verification.addons = catalog.addons.length;
      for (const d of catalog.drops)
        if (d.reason === 'unknown' && !out.drops.unknown.includes(d.name)) out.drops.unknown.push(d.name);

      const plans: LineupPlanDraft[] = verified.plans.map((p) => ({
        name: p.name,
        priceText: p.priceText,
        priceAmount: p.priceAmount,
        priceCurrency: p.priceCurrency,
        url: p.url,
        sources: p.sources.slice(0, LINEUP_MAX_SOURCES),
        verification: p.verification,
        channels: p.channels.map((c) => ({
          channelId: c.entryId,
          access: c.access,
          sources: c.sources.slice(0, LINEUP_MAX_SOURCES),
          verification: c.verification,
        })),
        services: p.services.map((c) => ({
          serviceId: c.entryId,
          access: c.access,
          sources: c.sources.slice(0, LINEUP_MAX_SOURCES),
          verification: c.verification,
        })),
      }));
      out.accepted = plans.length;
      if (plans.length || catalog.addons.length) {
        const r = await upsertLineupDraft(db, {
          platform: {
            slug: row.slug,
            name: row.name,
            kind: row.kind,
            country: row.country,
            website: row.website,
            broadcasterId: row.broadcasterId,
            sources: row.sources,
          },
          plans,
          addons: catalog.addons.map((a) => ({ ...a, url: null })),
          seenAt: this.now(),
          // só a revisita com resultado marca o que sumiu: pesquisa vazia não apaga nada
          complete: task.reason === 'revisit' && plans.length > 0,
        });
        this.add(out, r);
      }
      const v = out.verification;
      this.log(
        `${task.slug}: ${listed.length} plano(s) listado(s), ${plans.length} com fonte (${v.pricedPlans} com preço provado) · ` +
          `canais e streamings: ${v.included} incluso(s), ${v.addon} adicional(is), ${v.unverified} sem prova · ` +
          `${v.addons} complemento(s) · ${out.created} novo(s), ${out.changes.length} mudança(s)` +
          (out.missingPlans.length ? ` · plano(s) faltando: ${out.missingPlans.join(', ')}` : '') +
          (out.skippedPlans.length ? ` · sem orçamento para: ${out.skippedPlans.join(', ')}` : '') +
          (out.drops.unknown.length ? ` · fora da biblioteca: ${out.drops.unknown.length}` : '') +
          (out.drops.inactive.length ? ` · extintos: ${out.drops.inactive.join(', ')}` : ''),
      );
      return out;
    } catch (err) {
      return this.failed(out, err);
    }
  }

  private tally(out: LineupCallOutcome, v: VerifyOutcome): void {
    const s = out.verification;
    out.drops.noSource += v.plansWithoutSource;
    for (const d of v.drops) {
      if (d.reason === 'no_source') out.drops.noSource++;
      else if (d.reason === 'blocked') out.drops.blocked++;
      else if (d.reason === 'unknown' && !out.drops.unknown.includes(d.name)) out.drops.unknown.push(d.name);
      else if (d.reason === 'inactive' && !out.drops.inactive.includes(d.name))
        out.drops.inactive.push(d.name);
    }
    const tier = (t: string | null) => {
      const k = t ?? 'unresolved';
      s.tiers[k] = (s.tiers[k] ?? 0) + 1;
    };
    for (const p of v.plans) {
      s.plans++;
      if (p.priceAmount !== null) s.pricedPlans++;
      tier(p.verification.tier);
      for (const i of [...p.channels, ...p.services]) {
        s[i.access]++;
        tier(i.verification.tier);
      }
    }
  }

  private add(out: LineupCallOutcome, r: Awaited<ReturnType<typeof upsertLineupDraft>>): void {
    out.created += r.created;
    out.updated += r.updated;
    out.unchanged += r.unchanged;
    out.removed += r.removed;
    out.drops.noSource += r.skipped;
    out.changes.push(...r.changes);
  }
}

/**
 * O conteúdo lido já basta para a extração? Tem preço e, fora o streaming, cita ao menos 5 canais da
 * biblioteca (a grade); senão o leitor tenta o JSON embutido e o navegador.
 */
export function enoughForExtraction(
  dir: CountryDirectory,
  kind: PlatformKind,
): (content: LineupPageContent) => boolean {
  const names = [
    ...new Set(
      dir.broadcasters
        .filter((b) => GRADE_CHANNEL_MEDIA.has(b.medium))
        .map((b) => spaced(b.name))
        .filter((n) => n.length >= 3),
    ),
  ];
  return (content) => {
    const all = [content.text, ...content.sections.map((s) => s.text)].join('\n');
    if (!amountsIn(all).some((a) => a.money)) return false;
    if (kind === 'streaming') return true;
    const text = ` ${spaced(all)} `;
    let hits = 0;
    for (const n of names) if (text.includes(` ${n} `) && ++hits >= 5) return true;
    return false;
  };
}

/** A plataforma descoberta já está gravada? Mesmo nome normalizado ou mesmo host do site. */
function matchExisting(
  existing: readonly LineupPlatform[],
  country: string,
  name: string,
  website: string | null,
): LineupPlatform | undefined {
  const key = normalizeName(name);
  const host = website ? hostOf(website) : null;
  return (
    existing.find((p) => p.slug === platformSlug(country, name)) ??
    existing.find((p) => normalizeName(p.name) === key) ??
    (host ? existing.find((p) => p.website && hostOf(p.website) === host) : undefined)
  );
}

/** Streaming que é o mesmo serviço de uma entrada da biblioteca. */
function streamingId(dir: CountryDirectory, name: string, kind: PlatformKind): string | null {
  if (kind !== 'streaming') return null;
  const r = dir.resolve(name);
  return r && STREAMING_MEDIA.has(r.entry.medium) ? r.entry.id : null;
}
