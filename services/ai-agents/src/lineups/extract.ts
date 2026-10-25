/**
 * Extração determinística da página oficial do plano (lida do nosso lado): a grade de canais, os
 * streamings inclusos e o preço de cada plano, e o catálogo de complementos da plataforma. Sem IA: a
 * estrutura da página decide (o cartão de cada plano, a lista de canais aberta dele, a seção de
 * complementos) e todo nome precisa casar com o dicionário de emissoras do país.
 *
 * - Grade de canais só de onde ela é do plano: a lista aberta pelo botão do próprio plano (seção
 *   renderizada) ou a página que é do próprio plano. Texto de marketing no cartão ("SporTV, ESPN, Globo e
 *   muito mais") não vira grade.
 * - Streaming incluso só de frase que diz incluso ("São 6 streamings inclusos...: ...").
 * - Preço: o primeiro do cartão que passa como cheio de lista (o promocional do 1º mês fica de fora).
 * - Complemento: nome que casa com o dicionário seguido do preço; "FIDELIDADE 12 MESES" antes do nome
 *   (ou "Fidelidade" no nome) marca a oferta com fidelidade. O mesmo serviço pode ter várias ofertas.
 */
import type { AddonKind, LineupPageContent } from '@galaxie/db';
import { normalizeName, type BroadcasterEntry, type CountryDirectory } from '@galaxie/where-to-watch';
import {
  amountsIn,
  entryNames,
  GRADE_CHANNEL_MEDIA,
  INCLUDED_RE,
  isPlanPage,
  listPriceCheck,
  mentionsAny,
  spaced,
} from './validate.js';

const SERVICE_MEDIA = new Set(['streaming_svod', 'streaming_free', 'pay_tv']);

/** Começo da seção de complementos (o que se contrata à parte). */
const ADDON_SECTION_RE =
  /^(personalize seu plano|complementos?\b|adicionais\b|adicionales\b|add-?ons?\b|canais adicionais|canales adicionales|turbine seu plano|potencia tu plan|sum[aá] a tu plan|agreg[aá] a tu plan)/i;
/** Fim da seção de complementos. */
const ADDON_END_RE =
  /^(mostrar lista de canais|ver lista de canais|os melhores canais|d[uú]vidas|perguntas frequentes|preguntas frecuentes|faq\b)/i;
const COMMITMENT_RE = /(fidelidade|permanencia|permanência|contrato)\D{0,12}(\d{1,2})\s*mes/i;

/** Nomes para casar na página: o canônico sempre; apelidos e canais só com 4+ letras ("TNT" é ambíguo). */
function pageNames(entry: BroadcasterEntry, day: string): string[] {
  return entryNames(entry, day).filter((n, i) => i === 0 || normalizeName(n).length >= 4);
}

function entries(dir: CountryDirectory, day: string, media: ReadonlySet<string>): BroadcasterEntry[] {
  return dir.broadcasters.filter(
    (b) =>
      media.has(b.medium) &&
      (!b.validFrom || b.validFrom <= day) &&
      (!b.validTo || day <= b.validTo) &&
      !dir.blocklist.isBlockedName(b.name),
  );
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** A linha é o título do plano (começa com o nome dele, e não com o de um plano de nome mais longo)? */
export function headingOf(line: string, plans: readonly string[]): string | null {
  const l = spaced(line);
  const hits = plans
    .map((p) => spaced(p))
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s && (l === s || l.startsWith(`${s} `)))
    .sort((a, b) => b.s.length - a.s.length);
  // título é curto: a linha é o nome (com no máximo poucas palavras a mais), não uma frase
  const best = hits[0];
  if (!best || l.split(' ').length > best.s.split(' ').length + 3) return null;
  return plans[best.i]!;
}

/**
 * Cartão de cada plano no texto da página: do título dele até o título do próximo plano ou o começo da
 * seção de complementos. Plano sem título na página fica de fora.
 */
export function planCards(text: string, plans: readonly string[]): Map<string, string> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of lines(text)) {
    const plan = headingOf(line, plans);
    if (plan && !out.has(plan)) {
      cur = [line];
      out.set(plan, cur);
      continue;
    }
    if (ADDON_SECTION_RE.test(line) || (plan && out.has(plan))) {
      cur = null;
      continue;
    }
    cur?.push(line);
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n')]));
}

/** Seção aberta (a lista de canais) cujo rótulo é este plano. */
function planSection(content: LineupPageContent, plan: string, plans: readonly string[]): string | null {
  const own = content.sections.filter((s) => s.label && headingOf(s.label, plans) === plan);
  return own.length ? own.map((s) => s.text).join('\n') : null;
}

export interface PageGrade {
  plan: string;
  /** De onde veio a grade de canais: section = lista aberta do plano · plan_page = página do plano. */
  gradeFrom: 'section' | 'plan_page' | null;
  /** Ids do dicionário (canais da grade). */
  channels: string[];
  /** Streamings inclusos (ids do dicionário). */
  services: string[];
  /** Preço cheio de lista do cartão. */
  price: number | null;
  /** Cartão do plano (onde o preço e os inclusos foram lidos). */
  card: string | null;
}

/** Grade, inclusos e preço de um plano na página oficial. */
export function extractPlanGrade(
  content: LineupPageContent,
  plan: string,
  plans: readonly string[],
  ctx: { dir: CountryDirectory; day: string; pageUrl: string; platformName: string },
): PageGrade {
  const card = planCards(content.text, plans).get(plan) ?? null;
  const section = planSection(content, plan, plans);
  const planPage = isPlanPage(ctx.pageUrl, plan, ctx.platformName);
  const gradeText = section ?? (planPage ? content.text : null);
  const channels = gradeText
    ? entries(ctx.dir, ctx.day, GRADE_CHANNEL_MEDIA)
        .filter((e) => mentionsAny(gradeText, pageNames(e, ctx.day)))
        .map((e) => e.id)
    : [];
  // inclusos: só frases que dizem incluso, no cartão do plano (ou na página do plano)
  const includeText = card ?? (planPage ? content.text : null);
  const sentences = includeText
    ? includeText
        .split(/(?<=[.!?])\s+|\n/)
        .filter((s) => INCLUDED_RE.test(s))
        .join('\n')
    : '';
  const services = sentences
    ? entries(ctx.dir, ctx.day, SERVICE_MEDIA)
        .filter((e) => mentionsAny(sentences, pageNames(e, ctx.day)))
        .map((e) => e.id)
    : [];
  let price: number | null = null;
  if (card)
    for (const a of amountsIn(card).filter((x) => x.money))
      if (listPriceCheck(card, a.value) === 'pass') {
        price = a.value;
        break;
      }
  return {
    plan,
    gradeFrom: section ? 'section' : gradeText ? 'plan_page' : null,
    channels,
    services,
    price,
    card,
  };
}

/** Rótulos de seções abertas que parecem planos e não estão entre os conhecidos (plano que a IA perdeu). */
export function unknownPlanLabels(content: LineupPageContent, known: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of content.sections) {
    const label = s.label?.trim();
    if (!label || headingOf(label, known)) continue;
    if (/^(plano|plan|pacote|paquete|pack)\b/i.test(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Nome de uma oferta de complemento → entrada do dicionário: sem "fidelidade" no nome; casa pelo nome,
 * apelido ou canal ("ESPN 6" fixa o canal); senão, pelo nome da entrada dentro do texto ("Disney+
 * Padrão" é o Disney+). null = fora da biblioteca.
 */
export function resolveOffer(
  name: string,
  dir: CountryDirectory,
  day: string,
): { entry: BroadcasterEntry; channel: string | null; bare: string } | null {
  const bare = name.replace(/\b(fidelidade|permanencia|permanência)\b/gi, '').trim() || name;
  const resolved = dir.resolve(bare, day) ?? dir.resolve(name, day);
  if (resolved) return { entry: resolved.entry, channel: resolved.channel, bare };
  const entry = entries(dir, day, new Set([...SERVICE_MEDIA, ...GRADE_CHANNEL_MEDIA])).find((e) =>
    mentionsAny(bare, pageNames(e, day)),
  );
  return entry ? { entry, channel: null, bare } : null;
}

export interface PageAddon {
  kind: AddonKind;
  refId: string;
  /** Canal numerado ("ESPN 6"), quando o complemento é um canal. */
  channel: string | null;
  /** Nome como a página publica. */
  name: string;
  price: number;
  commitmentMonths: number | null;
  /** Trecho da página com o nome e o preço. */
  excerpt: string;
}

/**
 * Catálogo de complementos da página: da seção "Personalize seu plano" (e parecidas) até o fim dela.
 * `unknown`: nomes com preço que não casam com o dicionário (para a curadoria).
 */
export function extractAddons(
  content: LineupPageContent,
  ctx: { dir: CountryDirectory; day: string },
): { offers: PageAddon[]; unknown: string[] } {
  const all = lines(content.text);
  const start = all.findIndex((l) => ADDON_SECTION_RE.test(l));
  if (start < 0) return { offers: [], unknown: [] };
  const offers: PageAddon[] = [];
  const unknown: string[] = [];
  let pending: { line: string; index: number } | null = null;
  for (let i = start + 1; i < all.length; i++) {
    const line = all[i]!;
    if (ADDON_END_RE.test(line)) break;
    const money = amountsIn(line).find((a) => a.money);
    if (!money) {
      // linha de nome: texto curto que não é rótulo de período nem de ação
      if (
        line.length <= 60 &&
        !/^(por m[eê]s|al mes|detalhes|detalles|assinar|contratar|fidelidade|permanencia)\b/i.test(line)
      )
        pending = { line, index: i };
      continue;
    }
    if (!pending || i - pending.index > 3) continue;
    const name = pending.line;
    const before = all.slice(Math.max(start, pending.index - 2), pending.index).join(' ');
    const months =
      Number(COMMITMENT_RE.exec(before)?.[2] ?? COMMITMENT_RE.exec(name)?.[2] ?? '') ||
      (/fidelidade|permanencia|permanência/i.test(name) ? 12 : null);
    const found = resolveOffer(name, ctx.dir, ctx.day);
    const bare = found?.bare ?? name.replace(/\b(fidelidade|permanencia|permanência)\b/gi, '').trim();
    const entry = found?.entry ?? null;
    if (!entry || ctx.dir.blocklist.isBlockedName(entry.name)) {
      if (!unknown.includes(bare)) unknown.push(bare);
      pending = null;
      continue;
    }
    const channel = found?.channel ?? null;
    offers.push({
      kind:
        channel || (GRADE_CHANNEL_MEDIA.has(entry.medium) && !SERVICE_MEDIA.has(entry.medium))
          ? 'channel'
          : 'service',
      refId: entry.id,
      channel,
      name,
      price: money.value,
      commitmentMonths: months || null,
      excerpt: [before, name, line].filter(Boolean).join(' · '),
    });
    pending = null;
  }
  return { offers, unknown };
}
