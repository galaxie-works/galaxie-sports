/**
 * Pesquisa da grade pela página oficial (o caminho padrão de `lineups:research`): a busca na web custava
 * quase todo o gasto da grade (~10 buscas por chamada só para o modelo ler páginas que o nosso leitor
 * já lê). Agora:
 *
 * 1. a página de planos da plataforma vem do banco (`platform.plan_pages` ou as páginas oficiais dos
 *    planos já gravados); só sem nenhuma, uma chamada curta com busca descobre as URLs e elas ficam
 *    guardadas;
 * 2. a página é lida do nosso lado (`pages.ts`: HTML estático → JSON embutido → navegador);
 * 3. página igual à da última extração (hash): nenhuma chamada ao modelo;
 * 4. página nova ou mudada: uma chamada de nível leve, SEM busca, extrai do texto os planos, os preços,
 *    a grade, os inclusos e os complementos, cada um com o trecho literal da página;
 * 5. o validador determinístico (`validate.ts`) decide a prova; aqui o trecho também precisa estar na
 *    página, e o trecho dentro do cartão ou da lista aberta do plano prova o plano. Nada sem prova some:
 *    entra como `unverified`, com a checagem que falhou, para a revisão no painel.
 *
 * Este arquivo tem as partes puras (hash, onde o trecho está na página, a resposta do modelo → entrada
 * do validador); a execução fica em `research.ts`.
 */
import { createHash } from 'node:crypto';
import type { LineupPageContent, LineupPageRef, LineupPageVia, LineupVerification } from '@galaxie/db';
import { normalizeName, type CountryDirectory } from '@galaxie/where-to-watch';
import { sanitizeText } from '../llm/hygiene.js';
import { headingOf, planCards } from './extract.js';
import {
  LINEUP_MAX_CHANNELS,
  LINEUP_MAX_PLANS,
  LINEUP_MAX_SERVICES,
  type LineupPageExtractOutput,
} from './schema.js';
import {
  isPlanPage,
  spaced,
  type ModelAddon,
  type ModelPlan,
  type PageProof,
  type PlatformOfficial,
  type VerifyContext,
} from './validate.js';

/** Página oficial lida (do cache ou agora) com conteúdo. */
export interface ReadablePage {
  /** URL final da leitura (a que vale como fonte). */
  url: string;
  content: LineupPageContent;
  hash: string;
  via: LineupPageVia | null;
  fetchedAt: Date;
}

/** Hash do conjunto de páginas de planos de uma plataforma: URL e hash de cada página, sem ordem. */
export function pagesHash(pages: readonly Pick<ReadablePage, 'url' | 'hash'>[]): string {
  return createHash('sha256')
    .update(
      pages
        .map((p) => `${p.url}|${p.hash}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');
}

/** A extração precisa rodar? Só sem extração anterior, com página mudada ou se forçada. */
export function needsExtraction(previousHash: string | null, currentHash: string, force = false): boolean {
  return force || !previousHash || previousHash !== currentHash;
}

export const pageRefOf = (p: ReadablePage): LineupPageRef => ({
  url: p.url,
  fetched_at: p.fetchedAt.toISOString(),
  hash: p.hash,
  via: p.via ?? 'static',
});

const pad = (s: string) => ` ${spaced(s)} `;

/** Pedaços do trecho (o modelo pode cortar com "..."), normalizados. */
export const excerptChunks = (excerpt: string): string[] =>
  excerpt
    .split(/\.{3,}|…/)
    .map((c) => spaced(c))
    .filter(Boolean);

const contains = (hay: string, chunks: readonly string[]) =>
  chunks.length > 0 && chunks.every((c) => hay.includes(` ${c} `));

export interface PageLocator {
  /** URL da primeira página que contém o trecho (null = em nenhuma). */
  locate(excerpt: string | null): string | null;
  /** Onde o trecho está na página `url`: no texto e em quais cartões ou listas de plano. */
  proof(url: string, excerpt: string): PageProof;
}

/**
 * Índice das páginas para conferir os trechos: o texto todo, o cartão de cada plano (do título até o
 * próximo plano) e cada lista aberta pelo botão de um plano (rótulo = o cartão). Página que é a de um
 * plano (pela URL) é inteira desse plano.
 */
export function pageLocator(
  pages: readonly ReadablePage[],
  plans: readonly string[],
  platformName: string,
): PageLocator {
  const index = pages.map((p) => {
    // os rótulos das listas abertas também são títulos de plano: o plano que o modelo não listou não
    // empresta o cartão nem a lista dele a um plano de nome mais curto ("Plano X Total" ≠ "Plano X")
    const titles = [...plans];
    for (const s of p.content.sections)
      if (s.label && !titles.some((t) => spaced(t) === spaced(s.label!))) titles.push(s.label);
    const mine = (title: string | null) => (title && plans.includes(title) ? title : null);
    const blocks: { plan: string; text: string }[] = [];
    for (const [title, card] of planCards(p.content.text, titles)) {
      const plan = mine(title);
      if (plan) blocks.push({ plan, text: pad(card) });
    }
    for (const s of p.content.sections) {
      const plan = mine(s.label ? headingOf(s.label, titles) : null);
      if (plan) blocks.push({ plan, text: pad(s.text) });
    }
    const all = pad([p.content.text, ...p.content.sections.map((s) => s.text)].join('\n'));
    for (const plan of plans) if (isPlanPage(p.url, plan, platformName)) blocks.push({ plan, text: all });
    return { url: p.url, all, blocks };
  });
  return {
    locate(excerpt) {
      if (!excerpt) return null;
      const chunks = excerptChunks(excerpt);
      return index.find((p) => contains(p.all, chunks))?.url ?? null;
    },
    proof(url, excerpt) {
      const chunks = excerptChunks(excerpt);
      const page = index.find((p) => p.url === url);
      if (!page || !contains(page.all, chunks)) return { found: false, planBlocks: [] };
      const planBlocks = [...new Set(page.blocks.filter((b) => contains(b.text, chunks)).map((b) => b.plan))];
      return { found: true, planBlocks };
    },
  };
}

const clean = (s: string, max = 160) => sanitizeText(s, max).replace(/\s+/g, ' ').trim();

/** Nomes dos planos da resposta, limpos e sem repetir (a ordem da página). */
export function extractedPlanNames(out: LineupPageExtractOutput): string[] {
  const names: string[] = [];
  for (const p of out.planos) {
    const name = clean(p.plano_nome);
    if (name && !names.some((n) => normalizeName(n) === normalizeName(name))) names.push(name);
  }
  return names.slice(0, LINEUP_MAX_PLANS);
}

/**
 * Resposta da extração → entrada do validador. Nenhum dado do modelo é corrigido: a URL de cada
 * evidência é a página onde o trecho está (o modelo não escreve URL); trecho que não está em nenhuma
 * página fica com a primeira página e o validador marca `page = fail`. `truncated`: algum limite
 * (planos, canais ou streamings por plano) cortou a resposta, que então não é a grade completa.
 */
export function modelsFromExtraction(
  out: LineupPageExtractOutput,
  ctx: {
    pages: readonly ReadablePage[];
    locator: PageLocator;
    platformName: string;
    /** Nomes de plano recusados antes (política editorial, injeção). */
    skip?: (name: string) => boolean;
  },
): { plans: ModelPlan[]; addons: ModelAddon[]; truncated: boolean } {
  const fallback = ctx.pages[0]?.url ?? null;
  const evidence = (excerpt: string | null) => ({
    url: ctx.locator.locate(excerpt) ?? fallback,
    excerpt: excerpt?.trim() ? excerpt : null,
  });
  const plans: ModelPlan[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const p of out.planos) {
    const name = clean(p.plano_nome);
    const key = normalizeName(name);
    if (!name || seen.has(key) || ctx.skip?.(name)) continue;
    seen.add(key);
    if (plans.length >= LINEUP_MAX_PLANS) {
      truncated = true;
      break;
    }
    if (p.canais.length > LINEUP_MAX_CHANNELS || p.streamings_inclusos.length > LINEUP_MAX_SERVICES)
      truncated = true;
    plans.push({
      name,
      priceAmount: null,
      currency: null,
      prices: p.precos
        .filter((x) => typeof x.preco_mensal === 'number' && x.preco_mensal > 0)
        .map((x) => ({
          amount: x.preco_mensal,
          currency: x.moeda_iso?.trim().toUpperCase() || null,
          date: null,
          evidence: evidence(x.trecho),
        })),
      planUrl: ctx.pages.find((pg) => isPlanPage(pg.url, name, ctx.platformName))?.url ?? null,
      evidence: evidence(p.trecho_do_plano),
      channels: p.canais.slice(0, LINEUP_MAX_CHANNELS).map((c) => ({
        name: clean(c.canal_nome, 120),
        evidence: evidence(c.trecho),
      })),
      services: p.streamings_inclusos.slice(0, LINEUP_MAX_SERVICES).map((s) => ({
        name: clean(s.streaming_nome, 120),
        evidence: evidence(s.trecho),
      })),
    });
  }
  const addons: ModelAddon[] = out.complementos.map((a) => ({
    name: clean(a.nome),
    kind: a.tipo === 'canal' ? 'channel' : 'service',
    amount: typeof a.preco_mensal === 'number' && a.preco_mensal > 0 ? a.preco_mensal : null,
    currency: a.moeda_iso?.trim().toUpperCase() || null,
    commitmentMonths: a.fidelidade_meses,
    evidence: evidence(a.trecho),
  }));
  return { plans, addons, truncated };
}

/**
 * Contexto do validador para a extração da página: a fonte é a página lida (URL final, sem
 * redirecionamento a seguir), só as páginas lidas valem e o trecho é conferido nelas.
 */
export function pageVerifyContext(input: {
  country: string;
  platform: PlatformOfficial & { name: string };
  dir: CountryDirectory;
  pages: readonly ReadablePage[];
  locator: PageLocator;
  now: Date;
}): VerifyContext {
  const urls = new Set(input.pages.map((p) => p.url));
  return {
    country: input.country,
    platform: input.platform,
    dir: input.dir,
    resolveUrl: async (u) => u,
    acceptUrl: (u) => (u && urls.has(u) && !input.dir.blocklist.isBlockedUrl(u) ? u : null),
    pageProof: (u, excerpt) => input.locator.proof(u, excerpt),
    now: input.now,
  };
}

/** Proveniência: a página lida de onde veio a evidência (URL, data da leitura, hash, forma). */
export function withPageRef(v: LineupVerification, pages: readonly ReadablePage[]): LineupVerification {
  const page = pages.find((p) => p.url === (v.final_url ?? v.source_url));
  return page ? { ...v, page: pageRefOf(page) } : v;
}
