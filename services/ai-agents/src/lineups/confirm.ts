/**
 * Confirmação da grade pela página oficial (job `lineups-pages`, sem LLM): para cada plataforma, lê as
 * páginas oficiais dos planos (`pages.ts`), extrai de forma determinística a grade, os inclusos, o preço
 * de cada plano e o catálogo de complementos (`extract.ts`) e grava como rascunho com a fonte oficial e
 * a proveniência (URL, data da leitura, hash). O grounding descobre plataformas, planos e preços; a
 * página oficial é o que confirma a grade e os inclusos.
 *
 * - Plano com a lista de canais lida: a grade fica completa (canal ou streaming que não está na página
 *   fica com `proposed_change.removed`); plano que só tem o cartão: preço e inclusos, sem mexer na grade.
 * - Plano que aparece na página e não está no banco (a IA perdeu) entra como rascunho.
 * - Preço: soma-se às observações anteriores; valores diferentes marcam conflito e vale o oficial mais
 *   recente (o da página, lido hoje).
 * - Hash da página mudou e o plano já foi revisado: mudança para revisar.
 * - Site oficial que redireciona para outro domínio: rebrand, mudança proposta na plataforma.
 * - Preço 0 publicado é plano grátis ("Grátis"). Valor inválido lido na página (preço negativo, moeda
 *   torta) não derruba nada: o item entra sem ele, com a sinalização para a revisão
 *   (`verification.flags`). Erro numa plataforma fica no resultado dela e a leitura segue nas outras.
 */
import { and, inArray, ne } from 'drizzle-orm';
import {
  getPlatformLineup,
  lineupSlug,
  platform as platformTable,
  proposeLineupChange,
  upsertLineupDraft,
  type Database,
  type LineupAddonDraft,
  type LineupChange,
  type LineupFieldFlag,
  type LineupPageContent,
  type LineupPageRef,
  type LineupPlanDraft,
  type LineupPlatform,
  type LineupPriceObservation,
  type LineupVerification,
} from '@galaxie/db';
import { hostOf, type WtwConfig } from '@galaxie/where-to-watch';
import { extractAddons, extractPlanGrade, unknownPlanLabels, type PageGrade } from './extract.js';
import type { OfficialPageReader, PageRead } from './pages.js';
import { choosePrice, COUNTRY_CURRENCY, formatPrice, isOfficialUrl, priceCurrency } from './validate.js';

export interface ConfirmDeps {
  db: Database;
  config: WtwConfig;
  reader: OfficialPageReader;
  now?: () => Date;
  log?: (m: string) => void;
}

export interface ConfirmOptions {
  countries: readonly string[];
  /** Só esta plataforma (slug). */
  platformSlug?: string;
  /** Ignora o cache das páginas. */
  force?: boolean;
  /** Páginas por plataforma (padrão 3). */
  maxPagesPerPlatform?: number;
}

export interface PlatformPagesOutcome {
  slug: string;
  country: string;
  pages: Pick<PageRead, 'url' | 'status' | 'via' | 'fromCache' | 'hashChanged' | 'error'>[];
  plans: {
    name: string;
    gradeFrom: PageGrade['gradeFrom'];
    channels: number;
    services: number;
    price: number | null;
    created: boolean;
  }[];
  addons: number;
  /** Complementos com preço que o dicionário não conhece (curadoria). */
  unknownAddons: string[];
  /** Domínio novo do site oficial (rebrand), quando o site redireciona. */
  rebrandTo: string | null;
  created: number;
  updated: number;
  removed: number;
  changes: LineupChange[];
  /** Valores lidos e recusados pelo gravador (o item entrou sem eles), para a revisão. */
  flagged: { item: string; flag: LineupFieldFlag }[];
  error?: string;
}

/** URLs oficiais candidatas da plataforma: as páginas e fontes oficiais dos planos, a mais citada primeiro. */
export function candidatePages(
  platform: Pick<LineupPlatform, 'website' | 'officialDomains'>,
  plans: { url: string | null; sources: { url: string | null }[]; verification: LineupVerification | null }[],
  max: number,
): string[] {
  const count = new Map<string, number>();
  for (const p of plans)
    for (const u of [
      p.url,
      p.verification?.page?.url,
      p.verification?.final_url,
      ...p.sources.map((s) => s.url),
    ])
      if (u && isOfficialUrl(u, platform)) count.set(u.replace(/#.*$/, ''), (count.get(u) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([u]) => u)
    .slice(0, max);
}

function pageVerification(
  read: PageRead,
  excerpt: string,
  now: Date,
  extra: Partial<LineupVerification['checks']> = {},
): LineupVerification {
  const finalUrl = read.finalUrl ?? read.url;
  return {
    source_url: read.url,
    final_url: finalUrl,
    final_host: hostOf(finalUrl),
    tier: 'official',
    excerpt: excerpt.slice(0, 600),
    checks: {
      redirect: 'skip',
      official: 'pass',
      excerpt: 'pass',
      plan_specific: 'pass',
      not_reused: 'pass',
      page: 'pass',
      ...extra,
    },
    verified: true,
    page: pageRef(read),
    checked_at: now.toISOString(),
  };
}

const pageRef = (read: PageRead): LineupPageRef => ({
  url: read.finalUrl ?? read.url,
  fetched_at: read.fetchedAt.toISOString(),
  hash: read.hash ?? '',
  via: read.via ?? 'static',
});

export async function confirmFromPages(
  deps: ConfirmDeps,
  opts: ConfirmOptions,
): Promise<PlatformPagesOutcome[]> {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const countries = opts.countries.map((c) => c.toUpperCase()).filter((c) => config.has(c));
  if (!countries.length) return [];
  const rows = await db
    .select()
    .from(platformTable)
    .where(and(inArray(platformTable.country, countries), ne(platformTable.reviewStatus, 'rejected')));
  const out: PlatformPagesOutcome[] = [];
  for (const row of rows
    .filter((r) => !opts.platformSlug || r.slug === opts.platformSlug)
    .sort((a, b) => a.slug.localeCompare(b.slug))) {
    // uma plataforma que falha não derruba as outras: o erro fica no resultado dela
    try {
      out.push(await confirmPlatform(deps, row, opts, now(), log));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${row.slug}: erro — ${message}`);
      out.push({ ...emptyOutcome(row), error: message });
    }
  }
  return out;
}

const emptyOutcome = (row: Pick<LineupPlatform, 'slug' | 'country'>): PlatformPagesOutcome => ({
  slug: row.slug,
  country: row.country,
  pages: [],
  plans: [],
  addons: 0,
  unknownAddons: [],
  rebrandTo: null,
  created: 0,
  updated: 0,
  removed: 0,
  changes: [],
  flagged: [],
});

async function confirmPlatform(
  deps: ConfirmDeps,
  row: LineupPlatform,
  opts: ConfirmOptions,
  now: Date,
  log: (m: string) => void,
): Promise<PlatformPagesOutcome> {
  const { db, config, reader } = deps;
  const dir = config.directory(row.country);
  const day = now.toISOString().slice(0, 10);
  const outcome = emptyOutcome(row);
  // rebrand: o site oficial passou a redirecionar para outro domínio
  if (row.website) {
    const target = await reader.rebrandTarget(row.website);
    if (target) {
      outcome.rebrandTo = target;
      await proposeLineupChange(
        db,
        { type: 'platform', id: row.id },
        {
          website: target,
          note: `o site oficial (${hostOf(row.website)}) redireciona para ${hostOf(target)}`,
        },
        now,
      );
    }
  }
  const lineup = await getPlatformLineup(db, row.id, { minReview: 'draft', includeUnverified: true });
  if (!lineup) return { ...outcome, error: 'plataforma inexistente' };
  const known = lineup.plans.map((p) => p.plan.name);
  const urls = candidatePages(
    row,
    lineup.plans.map((p) => ({
      url: p.plan.url,
      sources: p.plan.sources,
      verification: p.plan.verification,
    })),
    opts.maxPagesPerPlatform ?? 3,
  );
  if (!urls.length) {
    log(`${row.slug}: sem página oficial conhecida dos planos; pulada`);
    return outcome;
  }
  const ctxFor = (read: PageRead) => ({
    dir,
    day,
    pageUrl: read.finalUrl ?? read.url,
    platformName: row.name,
  });
  const enough = (content: LineupPageContent) =>
    known.some((p) => {
      const g = extractPlanGrade(content, p, known, { dir, day, pageUrl: urls[0]!, platformName: row.name });
      return g.gradeFrom !== null && g.channels.length > 0;
    });

  // por plano: a melhor leitura (com a lista de canais vence o só cartão)
  const best = new Map<string, { grade: PageGrade; read: PageRead }>();
  let addons: { read: PageRead; offers: ReturnType<typeof extractAddons>['offers'] } | null = null;
  let hashChanged = false;
  for (const url of urls) {
    const read = await reader.read(url, row, { platformId: row.id, force: opts.force ?? false, enough });
    outcome.pages.push({
      url,
      status: read.status,
      via: read.via,
      fromCache: read.fromCache,
      hashChanged: read.hashChanged,
      ...(read.error ? { error: read.error } : {}),
    });
    if (read.status !== 'ok' || !read.content) continue;
    hashChanged ||= read.hashChanged;
    const content = read.content;
    const names = [...new Set([...known, ...unknownPlanLabels(content, known)])];
    for (const plan of names) {
      const grade = extractPlanGrade(content, plan, names, ctxFor(read));
      if (!grade.card && !grade.gradeFrom) continue;
      const cur = best.get(plan);
      const score = (g: PageGrade) => (g.gradeFrom ? 2 : 0) + (g.card ? 1 : 0);
      if (!cur || score(grade) > score(cur.grade)) best.set(plan, { grade, read });
    }
    const found = extractAddons(content, { dir, day });
    if (found.offers.length && !addons) addons = { read, offers: found.offers };
    for (const n of found.unknown) if (!outcome.unknownAddons.includes(n)) outcome.unknownAddons.push(n);
  }

  const currency = COUNTRY_CURRENCY[row.country] ?? null;
  const plans: LineupPlanDraft[] = [];
  for (const [name, { grade, read }] of best) {
    const existing = lineup.plans.find((p) => p.plan.name === name)?.plan ?? null;
    const prev = existing?.verification ?? null;
    const pageUrl = read.finalUrl ?? read.url;
    // preço: as observações anteriores (menos as de página antigas) + a da página de hoje
    const observations: LineupPriceObservation[] = (prev?.prices ?? []).filter((o) => o.origin !== 'page');
    // a moeda que o cartão mostra junto do preço (US$ no Uruguai fica em USD); ambígua, o preço não entra
    const shown =
      grade.price !== null ? priceCurrency(null, grade.card ?? '', grade.price, currency).currency : null;
    if (grade.price !== null && shown)
      observations.push({
        amount: grade.price,
        currency: shown,
        origin: 'page',
        source_url: pageUrl,
        tier: 'official',
        source_date: read.fetchedAt.toISOString().slice(0, 10),
        seen_at: now.toISOString(),
        verified: true,
      });
    const { chosen, conflict } = choosePrice(observations);
    const verification: LineupVerification = {
      ...(prev ?? {}),
      ...pageVerification(read, grade.card ?? name, now),
      checks: { ...(prev?.checks ?? {}), ...pageVerification(read, '', now).checks },
      ...(observations.length ? { prices: observations } : {}),
      ...(conflict ? { price_conflict: true } : {}),
    };
    if (!conflict) delete verification.price_conflict;
    const complete = grade.gradeFrom !== null && grade.card !== null;
    plans.push({
      name,
      ...(chosen?.currency
        ? {
            priceAmount: chosen.amount,
            priceCurrency: chosen.currency,
            priceText: formatPrice(chosen.amount, chosen.currency, row.country),
          }
        : {}),
      url: existing?.url ?? (grade.gradeFrom === 'plan_page' ? pageUrl : null),
      sources: [pageUrl],
      verification,
      ...(grade.gradeFrom
        ? {
            channels: grade.channels.map((channelId) => ({
              channelId,
              access: 'included' as const,
              sources: [pageUrl],
              verification: pageVerification(
                read,
                `${name}: ${dir.byIdOrNull(channelId)?.name ?? channelId}`,
                now,
              ),
            })),
          }
        : {}),
      ...(grade.card
        ? {
            services: grade.services.map((serviceId) => ({
              serviceId,
              access: 'included' as const,
              sources: [pageUrl],
              verification: pageVerification(read, grade.card!, now, { included: 'pass' }),
            })),
          }
        : {}),
      completeLinks: complete,
    });
    outcome.plans.push({
      name,
      gradeFrom: grade.gradeFrom,
      channels: grade.channels.length,
      services: grade.services.length,
      price: chosen?.amount ?? null,
      created: !existing,
    });
  }

  const addonDrafts: LineupAddonDraft[] = (addons?.offers ?? []).map((o) => {
    // a moeda da linha do complemento; ambígua, o complemento entra sem preço
    const shown = priceCurrency(null, o.excerpt, o.price, currency).currency;
    return {
      kind: o.kind,
      refId: o.refId,
      channel: o.channel,
      name: o.name,
      priceAmount: shown ? o.price : null,
      priceCurrency: shown,
      priceText: shown
        ? `${formatPrice(o.price, shown, row.country)}${o.commitmentMonths ? ` · fidelidade de ${o.commitmentMonths} meses` : ''}`
        : null,
      commitmentMonths: o.commitmentMonths,
      url: addons!.read.finalUrl ?? addons!.read.url,
      sources: [addons!.read.finalUrl ?? addons!.read.url],
      verification: pageVerification(addons!.read, o.excerpt, now),
    };
  });
  outcome.addons = addonDrafts.length;

  if (plans.length || addonDrafts.length) {
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
      addons: addonDrafts,
      addonsComplete: addonDrafts.length > 0,
      seenAt: now,
    });
    outcome.created = r.created;
    outcome.updated = r.updated;
    outcome.removed = r.removed;
    outcome.changes = r.changes;
    outcome.flagged = r.flagged;
    // a página mudou: plano já revisado vira mudança para revisar (mesmo sem diferença na grade)
    if (hashChanged)
      for (const [name, { read }] of best) {
        const planId = r.planIds[lineupSlug(name)];
        if (planId && read.hashChanged)
          await proposeLineupChange(
            db,
            { type: 'plan', id: planId },
            {
              note: 'a página oficial do plano mudou',
              page_hash: read.hash ?? '',
              page_url: read.finalUrl ?? read.url,
            },
            now,
          );
      }
  }
  log(
    `${row.slug}: ${outcome.pages.filter((p) => p.status === 'ok').length}/${outcome.pages.length} página(s) lida(s) · ` +
      `${outcome.plans.length} plano(s) confirmado(s) (${outcome.plans.filter((p) => p.gradeFrom).length} com grade) · ` +
      `${outcome.addons} complemento(s)` +
      (outcome.plans.some((p) => p.created)
        ? ` · novo(s): ${outcome.plans
            .filter((p) => p.created)
            .map((p) => p.name)
            .join(', ')}`
        : '') +
      (outcome.rebrandTo ? ` · site redireciona para ${outcome.rebrandTo}` : '') +
      (outcome.flagged.length ? ` · ${outcome.flagged.length} valor(es) recusado(s) para revisar` : ''),
  );
  return outcome;
}
