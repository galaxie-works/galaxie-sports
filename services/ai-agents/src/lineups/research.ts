/**
 * Pesquisa da grade de canais e ofertas (job `lineups-research`): por país, descobre as principais
 * operadoras de TV paga, vMVPDs, combos de telecom e streamings com esporte; para cada uma, levanta os
 * planos, os canais esportivos de cada plano e os streamings inclusos.
 *
 * Regras, no código e não no prompt:
 * - fonte é obrigatória e precisa ter vindo da busca do provedor (`groundedUrls` do Gemini em dois
 *   passos; nos outros provedores, as citações). Item sem fonte ancorada não entra;
 * - nome ou domínio na blocklist editorial (config/broadcasters/_policy.yaml + WTW_BLOCKLIST_FILE/
 *   WTW_BLOCKLIST) descarta o item sem registrar o nome; agregadores não valem como fonte;
 * - canal e streaming precisam casar com uma entrada da biblioteca de emissoras (dicionário do país);
 *   nome desconhecido fica de fora (e aparece no relatório para a curadoria);
 * - tudo vai como `draft` por `upsertLineupDraft` (idempotente; aprovado não volta a rascunho).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  platform as platformTable,
  platformPlan,
  platformSlug,
  upsertLineupDraft,
  type Database,
  type LineupAccess,
  type LineupChange,
  type LineupPlanDraft,
  type LineupPlatform,
  type PlatformKind,
} from '@galaxie/db';
import { hostOf, normalizeName, type CountryDirectory, type WtwConfig } from '@galaxie/where-to-watch';
import { detectPromptInjection, isAllowedUrl } from '../guardrails/index.js';
import { BudgetExceededError } from '../llm/errors.js';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmClient, LlmResult } from '../llm/types.js';
import { discoveryPrompt, lineupSystemPrompt, plansPrompt } from './prompt.js';
import {
  LINEUP_DISCOVERY_SCHEMA,
  LINEUP_DISCOVERY_SCHEMA_NAME,
  LINEUP_MAX_CHANNELS,
  LINEUP_MAX_PLANS,
  LINEUP_MAX_PLATFORMS,
  LINEUP_MAX_SERVICES,
  LINEUP_MAX_SOURCES,
  LINEUP_PLANS_SCHEMA,
  LINEUP_PLANS_SCHEMA_NAME,
  type LineupDiscoveryOutput,
  type LineupOutputSource,
  type LineupPlansOutput,
} from './schema.js';

const DAY = 86_400_000;

/** Países do começo da grade. */
export const LINEUP_COUNTRIES = ['BR', 'AR', 'MX', 'CO', 'CL'] as const;
/** Itens vistos há mais que isto entram na revisita. */
export const LINEUP_STALE_DAYS = 30;

export const discoveryPurpose = (country: string) => `lineups:discover:${country}`;
export const plansPurpose = (slug: string, country: string) => `lineups:plans:${slug}:${country}`;

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
  /** Itens sem fonte ancorada. */
  noSource: number;
  /** Bloqueados pela política editorial (nome nunca registrado). */
  blocked: number;
  /** Canais/streamings sem entrada na biblioteca (nomes para a curadoria). */
  unknown: string[];
  /** Texto com padrão de prompt injection. */
  injection: number;
}

const emptyDrops = (): DropStats => ({ noSource: 0, blocked: 0, unknown: [], injection: 0 });

class SourceGate {
  constructor(
    private readonly anchor: (url: string | null | undefined) => string | null,
    private readonly dir: CountryDirectory,
  ) {}

  /** Fonte aceitável: ancorada na busca, http(s), fora da blocklist e não agregador. */
  accept(url: string | null | undefined): string | null {
    const real = this.anchor(url);
    if (!real || !isAllowedUrl(real)) return null;
    if (this.dir.blocklist.isBlockedUrl(real) || this.dir.isAggregator(real)) return null;
    return real;
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
 * plataformas sem plano. Com revisita: descoberta e planos dos itens vistos há mais de `staleDays`.
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
          plans: sql<number>`count(*)::int`,
          oldestPlan: sql<
            string | null
          >`min(${platformPlan.seenAt}) filter (where ${platformPlan.reviewStatus} <> 'rejected')`,
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
    for (const p of mine.filter((p) => p.plans === 0))
      tasks.push({
        kind: 'plans',
        country,
        platformId: p.id,
        slug: p.slug,
        name: p.name,
        reason: 'no_plans',
      });
  }
  return tasks;
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
  costUsd: number | null;
  /** Plataformas novas da descoberta (para pesquisar os planos em seguida). */
  newPlatforms: { id: string; slug: string; name: string }[];
  error?: string;
}

export interface LineupResearchDeps {
  db: Database;
  llm: LlmClient;
  config: WtwConfig;
  now?: () => Date;
  log?: (m: string) => void;
}

export interface LineupRunOptions extends Omit<PlanLineupOptions, 'now'> {
  /** Máximo de chamadas de pesquisa (descoberta + planos) nesta execução. */
  maxCalls: number;
}

const STREAMING_MEDIA = new Set(['streaming_svod', 'streaming_free']);
const CHANNEL_MEDIA = new Set(['pay_tv', 'free_tv']);

export class LineupResearcher {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;

  constructor(private readonly deps: LineupResearchDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
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
        calls++;
        const outcome = task.kind === 'discover' ? await this.discover(task) : await this.researchPlans(task);
        out.push(outcome);
        if (outcome.status === 'skipped') return out; // orçamento do dia esgotado
        if (task.kind === 'discover' && !opts.revisit)
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
      costUsd: null,
      newPlatforms: [],
    };
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
      out.costUsd = res.usage.costUsd ?? null;
      const gate = new SourceGate(anchorResolver(res), dir);
      const seenAt = this.now();
      const seen = new Set<string>();
      for (const p of res.data.platforms.slice(0, LINEUP_MAX_PLATFORMS)) {
        const name = cleanName(p.name);
        if (!name || seen.has(normalizeName(name))) continue;
        seen.add(normalizeName(name));
        const website = p.website && isAllowedUrl(p.website) ? p.website.trim() : null;
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

  /** Planos de uma plataforma, com canais esportivos e streamings inclusos. */
  async researchPlans(task: Extract<LineupTask, { kind: 'plans' }>): Promise<LineupCallOutcome> {
    const { db } = this.deps;
    const out = this.base(task);
    const dir = this.directory(task.country);
    const row = await this.platformRow(task.platformId);
    if (!row) return { ...out, status: 'failed', error: 'plataforma inexistente' };
    const known = await db
      .select({ name: platformPlan.name })
      .from(platformPlan)
      .where(eq(platformPlan.platformId, row.id));
    const channelNames = dir.broadcasters
      .filter((b) => CHANNEL_MEDIA.has(b.medium))
      .flatMap((b) => [b.name, ...b.channels]);
    const serviceNames = dir.broadcasters.filter((b) => STREAMING_MEDIA.has(b.medium)).map((b) => b.name);
    try {
      const res = await this.deps.llm.generateJson<LineupPlansOutput>({
        tier: 'research',
        system: lineupSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: plansPrompt({
              country: task.country,
              platform: { name: row.name, kind: row.kind, website: row.website },
              knownPlans: known.map((k) => k.name),
              channels: channelNames,
              services: serviceNames,
            }),
          },
        ],
        schema: LINEUP_PLANS_SCHEMA,
        schemaName: LINEUP_PLANS_SCHEMA_NAME,
        webSearch: true,
        maxOutputTokens: 12_000,
        purpose: plansPurpose(row.slug, task.country),
      });
      out.costUsd = res.usage.costUsd ?? null;
      const gate = new SourceGate(anchorResolver(res), dir);
      const plans = this.toPlanDrafts(res.data, gate, dir, out);
      out.accepted = plans.length;
      if (plans.length) {
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
          seenAt: this.now(),
          // só a revisita com resultado marca o que sumiu: pesquisa vazia não apaga nada
          complete: task.reason === 'revisit',
        });
        this.add(out, r);
      }
      this.log(
        `${task.slug}: ${plans.length} plano(s) com fonte · ${out.created} novo(s), ${out.changes.length} mudança(s)` +
          (out.drops.unknown.length ? ` · fora da biblioteca: ${out.drops.unknown.length}` : ''),
      );
      return out;
    } catch (err) {
      return this.failed(out, err);
    }
  }

  private toPlanDrafts(
    data: LineupPlansOutput,
    gate: SourceGate,
    dir: CountryDirectory,
    out: LineupCallOutcome,
  ): LineupPlanDraft[] {
    const plans: LineupPlanDraft[] = [];
    for (const p of data.plans.slice(0, LINEUP_MAX_PLANS)) {
      const name = cleanName(p.name, 160);
      if (!name) continue;
      if (dir.blocklist.isBlockedName(name)) {
        out.drops.blocked++;
        continue;
      }
      if (detectPromptInjection(name).length) {
        out.drops.injection++;
        continue;
      }
      const url = gate.accept(p.url);
      const sources = gate.many(p.sources, [url]);
      if (!sources.length) {
        out.drops.noSource++;
        continue;
      }
      const channels = new Map<string, { access: LineupAccess; sources: string[] }>();
      const services = new Map<string, { access: LineupAccess; sources: string[] }>();
      const items = [
        ...p.channels.slice(0, LINEUP_MAX_CHANNELS).map((i) => ({ ...i, as: 'channel' as const })),
        ...p.services.slice(0, LINEUP_MAX_SERVICES).map((i) => ({ ...i, as: 'service' as const })),
      ];
      for (const item of items) {
        const itemName = cleanName(item.name);
        if (!itemName) continue;
        if (dir.blocklist.isBlockedName(itemName)) {
          out.drops.blocked++;
          continue;
        }
        const src = gate.accept(item.source_url);
        if (!src) {
          out.drops.noSource++;
          continue;
        }
        const resolved = dir.resolve(itemName);
        if (!resolved || dir.blocklist.isBlockedName(resolved.entry.name)) {
          if (!resolved && !out.drops.unknown.includes(itemName)) out.drops.unknown.push(itemName);
          else if (resolved) out.drops.blocked++;
          continue;
        }
        const medium = resolved.entry.medium;
        // o meio vem do dicionário, não do modelo
        const target = STREAMING_MEDIA.has(medium) ? services : CHANNEL_MEDIA.has(medium) ? channels : null;
        if (!target) continue;
        const cur = target.get(resolved.entry.id);
        if (!cur) target.set(resolved.entry.id, { access: item.access, sources: [src] });
        else {
          if (item.access === 'included') cur.access = 'included';
          if (!cur.sources.includes(src)) cur.sources.push(src);
        }
      }
      plans.push({
        name,
        priceText: p.price_text ? cleanName(p.price_text, 120) || null : null,
        url,
        sources,
        channels: [...channels].map(([channelId, v]) => ({ channelId, ...v })),
        services: [...services].map(([serviceId, v]) => ({ serviceId, ...v })),
      });
    }
    return plans;
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
