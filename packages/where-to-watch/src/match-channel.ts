/**
 * Canal do jogo (docs/07 §2.2.4): qual detentor dos direitos passa (ou passou) cada jogo, com a fonte.
 *
 * A pesquisa (job `wtw-channel`, Gemini com grounding) só PROPÕE: o modelo escolhe ids (jogo da lista,
 * emissora da biblioteca, canal da emissora) e aponta a fonte. Este validador determinístico decide:
 *
 * 1. a emissora é detentora conhecida da competição no país (linha de direitos efetiva) e o canal,
 *    quando informado, é um canal dela;
 * 2. a URL veio da busca do provedor (grounding), é http(s) pública e não está bloqueada;
 * 3. a fonte é oficial (organizador, a própria emissora ou o grupo dela) ou imprensa esportiva do
 *    país — agregador e domínio desconhecido não contam;
 * 4. o trecho cita os dois times e a emissora/canal; a página, quando foi possível buscá-la, cita a
 *    emissora (senão a evidência cai) e, com os dois times e a emissora juntos (a até 40 palavras),
 *    soma confiança. O canal (subcanal) só é gravado quando a fonte o cita pelo nome dele — a fonte
 *    que só cita a emissora ou um canal irmão sustenta a emissora, sem o canal;
 * 5. fonte com data mais de 30 dias antes do jogo só vale se o trecho citar a data do jogo (tabela
 *    da temporada); senão é descartada (escala de outra rodada ou temporada).
 *
 * Confiança: oficial 0,9 · imprensa 0,7 · +0,1 página conferida · +0,1 segunda fonte independente.
 * Grava com ≥ 0,8 — imprensa sozinha e sem página conferida fica "a confirmar". Fonte oficial vale mais:
 * quando uma pesquisa confirma o jogo por fonte oficial, o canal que só a imprensa sustentava e que
 * a fonte oficial não repetiu sai (`retracted`).
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  matchChannel,
  type Database,
  type MatchChannelEvidence,
  type MatchChannelPhase,
  type MatchChannelSourceKind,
} from '@galaxie/db';
import type { CountryDirectory } from './config/directory.js';
import type { BroadcasterEntry, RightsEntry } from './config/types.js';
import { clipExcerpt, hostOf, isHttpUrl, normalizeName, registrableDomain } from './normalize.js';
import { notifyChange } from './store.js';

export type MatchChannelRow = typeof matchChannel.$inferSelect;

export const CHANNEL_SCORING = {
  official: 0.9,
  press: 0.7,
  pageVerified: 0.1,
  independentSources: 0.1,
  confirmThreshold: 0.8,
  /** Fonte publicada antes disso (em relação ao início do jogo) é de outra rodada/temporada. */
  maxSourceAgeDays: 30,
  maxEvidence: 4,
} as const;

/** Produtor das opções sintetizadas a partir do canal do jogo (leitura pública). */
export const MATCH_CHANNEL_PRODUCER = 'agent:wtw-channel@v1';

// ─── nomes dos times ─────────────────────────────────────────────────────────────────────────────

/** Palavras que não identificam o time sozinhas (FC, Clube, Atlético...). */
const GENERIC_WORDS = new Set([
  'fc', 'sc', 'ec', 'ac', 'cf', 'cd', 'ca', 'cr', 'se', 'sd', 'ad', 'fbc', 'sad', 'saf', 'rb', 'afc',
  'club', 'clube', 'clubes', 'esporte', 'esportivo', 'futebol', 'football', 'futbol', 'sport', 'sports',
  'associacao', 'sociedade', 'atletico', 'athletico', 'deportivo', 'deportiva', 'de', 'da', 'do', 'dos',
  'das', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'and', 'the',
]); // prettier-ignore

/** Primeiras palavras que não bastam sozinhas ("Universidad" é de vários clubes). */
const AMBIGUOUS_FIRST = new Set([
  'universidad', 'union', 'deportes', 'real', 'racing', 'nacional', 'independiente', 'estudiantes',
  'america', 'santa', 'san', 'sao', 'sporting', 'cerro', 'defensa', 'gimnasia', 'juventud', 'inter',
  'internacional', 'atletico', 'club', 'ciudad', 'central', 'river', 'boca', 'rosario', 'puerto',
]); // prettier-ignore

/** Palavras normalizadas do texto (sem acento, minúsculas, só [a-z0-9]). */
export function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Variantes pelas quais um time pode aparecer: o nome e o nome curto inteiros; o núcleo sem palavras
 * genéricas ("RB Bragantino" → "Bragantino"); a primeira palavra do núcleo quando ela identifica o time
 * ("Vasco da Gama" → "Vasco"); e o começo de um nome longo de uma palavra ("Inter" → "Internacional").
 */
export interface TeamNames {
  full: string[][];
  core: string[][];
  first: string[];
  long: string[];
}

export function teamNames(name: string, shortName?: string | null): TeamNames {
  const full = [words(name), ...(shortName ? [words(shortName)] : [])].filter((w) => w.length > 0);
  const core = full.map((w) => w.filter((x) => !GENERIC_WORDS.has(x))).filter((w) => w.join('').length >= 4);
  const first = core
    .filter((w) => w.length >= 2 && w[0]!.length >= 5 && !AMBIGUOUS_FIRST.has(w[0]!))
    .map((w) => w[0]!);
  const long = core.filter((w) => w.length === 1 && w[0]!.length >= 8).map((w) => w[0]!);
  return { full, core, first: [...new Set(first)], long: [...new Set(long)] };
}

/** Índices onde a sequência começa em `hay`. */
function seqHits(hay: string[], needle: string[]): number[] {
  const out: number[] = [];
  if (!needle.length || needle.length > hay.length) return out;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((w, j) => hay[i + j] === w)) out.push(i);
  return out;
}

/** Posições (índice da palavra no texto) em que o time aparece. */
function teamHits(all: string[], team: TeamNames): number[] {
  const hits = team.full.flatMap((v) => seqHits(all, v));
  const meaningful = all.map((w, i) => ({ w, i })).filter((x) => !GENERIC_WORDS.has(x.w));
  const mw = meaningful.map((x) => x.w);
  for (const v of team.core) hits.push(...seqHits(mw, v).map((j) => meaningful[j]!.i));
  for (const f of team.first) hits.push(...seqHits(all, [f]));
  for (const l of team.long)
    all.forEach((w, i) => {
      if (w.length >= 5 && w.length < l.length && l.startsWith(w)) hits.push(i);
    });
  return [...new Set(hits)].sort((a, b) => a - b);
}

/** O texto cita o time (nome completo, curto, núcleo, primeira palavra ou começo do nome longo)? */
export function mentionsTeam(text: string, team: TeamNames): boolean {
  return teamHits(words(text), team).length > 0;
}

/** Nomes pelos quais a emissora (ou o canal) pode aparecer num texto. */
export function broadcasterNames(entry: BroadcasterEntry, channel?: string | null): string[] {
  const names = [
    entry.name,
    ...entry.aliases,
    // cada canal com as grafias dele ("SporTV2" também cita a emissora)
    ...entry.channels.flatMap((c) => channelNames(entry, c)),
    ...(channel ? [channel] : []),
  ];
  return [...new Set(names.filter((n) => normalizeName(n).length >= 2))];
}

/**
 * Nomes pelos quais UM canal da emissora aparece num texto: o canal, os apelidos com validade que
 * apontam para ele e as grafias da emissora com o mesmo sufixo ("SportTV 2" para "SporTV 2"). Não
 * inclui a emissora genérica nem os canais irmãos: a fonte de "SporTV 3" não sustenta "SporTV 2".
 */
export function channelNames(entry: BroadcasterEntry, channel: string): string[] {
  const ch = words(channel);
  const base = words(entry.name);
  const suffix = base.length && base.every((w, i) => ch[i] === w) ? ch.slice(base.length) : [];
  const names = [
    channel,
    ...entry.datedAliases
      .filter((a) => a.channel && normalizeName(a.channel) === normalizeName(channel))
      .map((a) => a.name),
    // grafias da emissora com o sufixo, separado e junto ("SporTV 2", "SportTV 2", "SporTV2"); o apelido
    // que já traz o sufixo ("SportTV 2") entra como está
    ...(suffix.length
      ? [entry.name, ...entry.aliases].flatMap((n) => {
          const w = words(n);
          if (w.length > suffix.length && suffix.every((x, i) => w[w.length - suffix.length + i] === x))
            return [n];
          // um apelido de OUTRO canal ("SportTV 3") não vira grafia deste
          if (entry.channels.some((c) => normalizeName(c) !== normalizeName(channel) && sameStem(n, c, base)))
            return [];
          return [`${n} ${suffix.join(' ')}`, `${n}${suffix.join('')}`];
        })
      : []),
  ];
  return [...new Set(names.filter((n) => normalizeName(n).length >= 2))];
}

/** O nome é o de outro canal numerado da emissora com outra grafia ("SportTV 3" para "SporTV 3")? */
function sameStem(name: string, otherChannel: string, base: string[]): boolean {
  const w = words(name);
  const other = words(otherChannel).slice(base.length);
  return (
    other.length > 0 && w.length > other.length && other.every((x, i) => w[w.length - other.length + i] === x)
  );
}

/**
 * Posições em que a emissora aparece. Por palavras inteiras ("Globo" não casa com "Globoplay"); nomes
 * longos (≥ 6 letras) de uma palavra casam também separados em duas ("Cazé TV" = "CazéTV").
 */
function broadcasterHits(all: string[], names: string[]): number[] {
  const hits: number[] = [];
  for (const n of names) {
    const seq = words(n);
    hits.push(...seqHits(all, seq));
    const key = seq.join('');
    if (seq.length === 1 && key.length >= 6)
      for (let i = 0; i + 1 < all.length; i++) if (all[i]! + all[i + 1]! === key) hits.push(i);
  }
  return [...new Set(hits)].sort((a, b) => a - b);
}

/** O texto cita a emissora? */
export function mentionsBroadcaster(text: string, names: string[]): boolean {
  return broadcasterHits(words(text), names).length > 0;
}

/** Distância máxima (em palavras) entre os dois times e a emissora na mesma página. */
export const PAGE_PROXIMITY_WORDS = 40;

/** Separadores de confronto numa agenda ("Flamengo x Palmeiras", "A vs B"). */
const MATCH_SEPARATORS = new Set(['x', 'vs', 'versus']);

/**
 * A página cita os dois times e a emissora JUNTOS (a até `maxWords` palavras uns dos outros)? Numa
 * escala da rodada, todos os jogos e canais aparecem; só a proximidade liga este jogo a este canal.
 * Com `sameMatch`, o trecho entre eles não pode passar por outro confronto ("x" de outro jogo): numa
 * agenda compacta o canal do jogo vizinho fica a poucas palavras.
 */
export function mentionsTogether(
  text: string,
  teams: readonly [TeamNames, TeamNames],
  names: string[],
  maxWords = PAGE_PROXIMITY_WORDS,
  opts: { sameMatch?: boolean } = {},
): boolean {
  const all = words(opts.sameMatch ? text.replace(/×/g, ' x ') : text);
  const a = teamHits(all, teams[0]);
  const b = teamHits(all, teams[1]);
  const c = broadcasterHits(all, names);
  if (!a.length || !b.length || !c.length) return false;
  const seps = opts.sameMatch ? all.flatMap((w, i) => (MATCH_SEPARATORS.has(w) ? [i] : [])) : [];
  const oneMatch = (x: number, y: number, p: number) => {
    if (!opts.sameMatch) return true;
    const lo = Math.min(x, y, p);
    const hi = Math.max(x, y, p);
    return seps.filter((i) => i > lo && i < hi).length <= 1;
  };
  return c.some((p) =>
    a.some(
      (x) =>
        Math.abs(x - p) <= maxWords &&
        b.some((y) => Math.abs(y - p) <= maxWords && Math.abs(y - x) <= maxWords && oneMatch(x, y, p)),
    ),
  );
}

// ─── validador ───────────────────────────────────────────────────────────────────────────────────

/** Proposta do modelo para um jogo × país: só ids e a fonte. */
export interface ChannelProposal {
  broadcasterId: string;
  channel: string | null;
  evidence: { url: string; excerpt: string; publishedAt: string | null }[];
}

export interface FetchedPage {
  ok: boolean;
  text: string;
}

export interface ChannelValidationContext {
  directory: CountryDirectory;
  /** Direitos efetivos da competição no país (curada > pesquisada). */
  rights: RightsEntry | null;
  teams: [TeamNames, TeamNames];
  eventStartsAt: Date;
  now: Date;
  /** URLs que vieram da busca do provedor; ausente = sem garantia (outro provedor). */
  groundedUrls?: readonly string[] | null;
  /** Páginas buscadas por URL (verificação); ausente = não buscada. */
  pages?: ReadonlyMap<string, FetchedPage>;
  /**
   * Só aceita evidência com a página conferida (buscada e citando os dois times e a emissora): para o
   * provedor sem grounding garantido e para a importação das opções salvas.
   */
  requirePageVerified?: boolean;
}

export type EvidenceRejection =
  | 'not_grounded'
  | 'invalid_url'
  | 'blocked'
  | 'not_official_or_press'
  | 'excerpt_missing_teams'
  | 'excerpt_missing_channel'
  | 'page_missing_channel'
  | 'page_not_verified'
  | 'stale_source';

export interface ValidatedChannel {
  broadcasterId: string;
  providerName: string;
  channel: string | null;
  /**
   * Canais da emissora que a pesquisa propôs (citados ou não pela fonte). Com `channel` null, o canal
   * já gravado só fica se nenhum canal diferente foi proposto: senão o jogo pode ter mudado de canal.
   */
  proposedChannels?: string[];
  confidence: number;
  sourceKind: MatchChannelSourceKind;
  evidence: MatchChannelEvidence[];
}

export interface RejectedChannel {
  broadcasterId: string;
  reason: 'unknown_broadcaster' | 'not_a_rights_holder' | 'no_valid_source' | 'low_confidence';
  confidence?: number;
  evidence?: EvidenceRejection[];
}

export interface ChannelValidationReport {
  accepted: ValidatedChannel[];
  rejected: RejectedChannel[];
}

/**
 * O texto cita a data do jogo (dd/mm ou d/m, no dia em que é jogado nas Américas — UTC−3 a UTC−6)?
 * "24/10 - Inter x Botafogo" numa tabela publicada no início da temporada.
 */
export function mentionsDate(text: string, startsAt: Date): boolean {
  const forms = new Set<string>();
  for (const offset of [3, 4, 5, 6]) {
    const d = new Date(startsAt.getTime() - offset * 3_600_000);
    const day = d.getUTCDate();
    const month = d.getUTCMonth() + 1;
    for (const dd of [String(day), String(day).padStart(2, '0')])
      for (const mm of [String(month), String(month).padStart(2, '0')]) forms.add(`${dd}/${mm}`);
  }
  return [...forms].some((f) => new RegExp(`(^|[^0-9])${f}([^0-9]|$)`).test(text));
}

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

const OFFICIAL: MatchChannelEvidence['sourceKind'][] = ['broadcaster', 'organizer', 'editorial'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Valida as propostas de UM jogo × país (função pura: sem rede e sem banco). */
export function validateMatchChannels(
  proposals: ChannelProposal[],
  ctx: ChannelValidationContext,
): ChannelValidationReport {
  const { directory: dir, rights } = ctx;
  const grounded = ctx.groundedUrls ? new Set(ctx.groundedUrls.map(comparableUrl)) : null;
  const pages = new Map([...(ctx.pages ?? new Map())].map(([u, p]) => [comparableUrl(u), p]));
  const minPublished = ctx.eventStartsAt.getTime() - CHANNEL_SCORING.maxSourceAgeDays * 86_400_000;
  const accepted: ValidatedChannel[] = [];
  const rejected: RejectedChannel[] = [];

  // várias linhas da mesma emissora (canais diferentes) viram uma, com as evidências somadas
  const byId = new Map<string, ChannelProposal[]>();
  for (const p of proposals) byId.set(p.broadcasterId, [...(byId.get(p.broadcasterId) ?? []), p]);

  for (const [id, group] of byId) {
    const entry = dir.byIdOrNull(id);
    if (!entry || dir.blocklist.isBlockedName(entry.name)) {
      rejected.push({ broadcasterId: id, reason: 'unknown_broadcaster' });
      continue;
    }
    if (!rights || !rights.holders.includes(id)) {
      rejected.push({ broadcasterId: id, reason: 'not_a_rights_holder' });
      continue;
    }
    const channels = [
      ...new Set(
        group
          .map((p) => p.channel?.trim() || null)
          .filter(
            (c): c is string => !!c && entry.channels.some((x) => normalizeName(x) === normalizeName(c)),
          ),
      ),
    ];
    const names = broadcasterNames(entry);
    const byChannel = new Map(channels.map((c) => [c, channelNames(entry, c)]));
    const reasons: EvidenceRejection[] = [];
    const kept = new Map<string, MatchChannelEvidence & { score: number; channels: string[] }>();

    for (const p of group)
      for (const ev of p.evidence) {
        const url = ev.url.trim();
        if (!isHttpUrl(url)) {
          reasons.push('invalid_url');
          continue;
        }
        if (dir.blocklist.isBlockedUrl(url)) {
          reasons.push('blocked');
          continue;
        }
        if (grounded && !grounded.has(comparableUrl(url))) {
          reasons.push('not_grounded');
          continue;
        }
        const kind = dir.classifySource(url, entry);
        if (kind !== 'broadcaster' && kind !== 'organizer' && kind !== 'press') {
          reasons.push('not_official_or_press');
          continue;
        }
        const excerpt = clipExcerpt(ev.excerpt ?? '');
        if (!ctx.teams.every((t) => mentionsTeam(excerpt, t))) {
          reasons.push('excerpt_missing_teams');
          continue;
        }
        if (!mentionsBroadcaster(excerpt, names)) {
          reasons.push('excerpt_missing_channel');
          continue;
        }
        const published =
          ev.publishedAt && Number.isFinite(Date.parse(ev.publishedAt)) ? ev.publishedAt : null;
        // página antiga (tabela da temporada, escala de outra rodada) só vale citando a data do jogo
        if (published && Date.parse(published) < minPublished && !mentionsDate(excerpt, ctx.eventStartsAt)) {
          reasons.push('stale_source');
          continue;
        }
        const page = pages.get(comparableUrl(url));
        let pageVerified: boolean | null = null;
        if (page?.ok) {
          // página acessível que não cita a emissora: o trecho não saiu dela (anti-alucinação)
          if (!mentionsBroadcaster(page.text, names)) {
            reasons.push('page_missing_channel');
            continue;
          }
          // escala da rodada lista todos os jogos: só vale com os dois times e a emissora juntos
          pageVerified = mentionsTogether(page.text, ctx.teams, names);
        }
        if (ctx.requirePageVerified && pageVerified !== true) {
          reasons.push('page_not_verified');
          continue;
        }
        const score =
          (OFFICIAL.includes(kind) ? CHANNEL_SCORING.official : CHANNEL_SCORING.press) +
          (pageVerified ? CHANNEL_SCORING.pageVerified : 0);
        // canal proposto que o trecho (e a página, quando buscada) cita pelo nome dele
        const cited = channels.filter(
          (c) =>
            mentionsBroadcaster(excerpt, byChannel.get(c)!) &&
            (!page?.ok || mentionsBroadcaster(page.text, byChannel.get(c)!)),
        );
        const key = comparableUrl(url);
        const prev = kept.get(key);
        if (prev && prev.score >= score) {
          prev.channels = [...new Set([...prev.channels, ...cited])];
          continue;
        }
        kept.set(key, {
          url,
          publisher: hostOf(url)!,
          excerpt,
          sourceKind: kind,
          publishedAt: published,
          pageVerified,
          fetchedAt: ctx.now.toISOString(),
          score,
          channels: [...new Set([...(prev?.channels ?? []), ...cited])],
        });
      }

    const support = [...kept.values()].sort((a, b) => b.score - a.score);
    // sem fonte que cite o canal escolhido, grava só a emissora (sem o canal)
    const channel = channels.find((c) => support.some((e) => e.channels.includes(c))) ?? null;
    if (!support.length) {
      rejected.push({ broadcasterId: id, reason: 'no_valid_source', evidence: [...new Set(reasons)] });
      continue;
    }
    const domains = new Set(support.map((e) => registrableDomain(e.publisher)));
    const confidence = round2(
      Math.min(1, support[0]!.score + (domains.size >= 2 ? CHANNEL_SCORING.independentSources : 0)),
    );
    if (confidence < CHANNEL_SCORING.confirmThreshold) {
      rejected.push({ broadcasterId: id, reason: 'low_confidence', confidence });
      continue;
    }
    accepted.push({
      broadcasterId: id,
      providerName: entry.name,
      channel: channel && normalizeName(channel) !== normalizeName(entry.name) ? channel : null,
      proposedChannels: channels,
      confidence,
      sourceKind: support.some((e) => OFFICIAL.includes(e.sourceKind)) ? 'official' : 'press',
      evidence: support.slice(0, CHANNEL_SCORING.maxEvidence).map(({ score: _s, channels: _c, ...e }) => e),
    });
  }
  accepted.sort((a, b) => a.broadcasterId.localeCompare(b.broadcasterId));
  return { accepted, rejected };
}

// ─── gravação ────────────────────────────────────────────────────────────────────────────────────

/** Canais do jogo vigentes (confirmados e retirados) de um evento × país. */
export async function currentMatchChannels(
  db: Database,
  eventId: string,
  country: string,
): Promise<MatchChannelRow[]> {
  return db
    .select()
    .from(matchChannel)
    .where(and(eq(matchChannel.eventId, eventId), eq(matchChannel.countryCode, country.toUpperCase())));
}

const KIND_RANK: Record<MatchChannelEvidence['sourceKind'], number> = {
  editorial: 3,
  broadcaster: 2,
  organizer: 2,
  press: 1,
};

/** Junta as evidências (por URL), da melhor fonte para a pior. */
function mergeEvidence(a: MatchChannelEvidence[], b: MatchChannelEvidence[]): MatchChannelEvidence[] {
  const out = new Map<string, MatchChannelEvidence>();
  for (const e of [...b, ...a]) if (!out.has(comparableUrl(e.url))) out.set(comparableUrl(e.url), e);
  return [...out.values()]
    .sort(
      (x, y) =>
        KIND_RANK[y.sourceKind] - KIND_RANK[x.sourceKind] ||
        Number(y.pageVerified === true) - Number(x.pageVerified === true),
    )
    .slice(0, CHANNEL_SCORING.maxEvidence);
}

/**
 * Canal gravado que continua quando a validação nova confirma só a emissora: fica se a pesquisa não
 * propôs canal ou só propôs o mesmo; outro canal proposto (sem fonte que o cite) limpa — o jogo pode
 * ter mudado de canal e o antigo não deve seguir publicado.
 */
function keptChannel(prev: string | null, proposed: string[]): string | null {
  if (!prev) return null;
  return proposed.every((c) => normalizeName(c) === normalizeName(prev)) ? prev : null;
}

export interface ApplyMatchChannelsInput {
  eventId: string;
  country: string;
  accepted: ValidatedChannel[];
  phase: MatchChannelPhase;
  /** T-5d, T-48h, T-6h, post ou import. */
  window: string;
  researchId: string | null;
  now: Date;
}

export interface ApplyMatchChannelsResult {
  inserted: number;
  updated: number;
  retracted: number;
  changed: boolean;
}

/**
 * Grava o canal do jogo validado (upsert por evento × país × emissora). Confirmação depois do jogo marca
 * `post_confirmed_at`. Com fonte oficial nesta pesquisa, o canal só da imprensa que ela não repetiu sai.
 */
export async function applyMatchChannels(
  db: Database,
  input: ApplyMatchChannelsInput,
): Promise<ApplyMatchChannelsResult> {
  const country = input.country.toUpperCase();
  const result: ApplyMatchChannelsResult = { inserted: 0, updated: 0, retracted: 0, changed: false };
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`wtw-channel:${input.eventId}:${country}`}))`,
    );
    const current = await tx
      .select()
      .from(matchChannel)
      .where(and(eq(matchChannel.eventId, input.eventId), eq(matchChannel.countryCode, country)));
    const byId = new Map(current.map((r) => [r.broadcasterId, r]));
    for (const a of input.accepted) {
      const prev = byId.get(a.broadcasterId);
      const evidence = mergeEvidence(prev?.status === 'confirmed' ? prev.evidence : [], a.evidence);
      const best = evidence[0]!;
      const sourceKind: MatchChannelSourceKind =
        a.sourceKind === 'official' || prev?.sourceKind === 'official' ? 'official' : 'press';
      const values = {
        channelName: a.channel ?? keptChannel(prev?.channelName ?? null, a.proposedChannels ?? []),
        status: 'confirmed' as const,
        confidence: Math.max(
          a.confidence,
          prev?.status === 'confirmed' ? Number(prev.confidence) : 0,
        ).toFixed(2),
        sourceKind,
        sourceUrl: best.url,
        sourcePublisher: best.publisher,
        sourceExcerpt: best.excerpt,
        sourcePublishedAt: best.publishedAt ? new Date(best.publishedAt) : null,
        evidence,
        phase: input.phase,
        window: input.window,
        researchId: input.researchId,
        confirmedAt: input.now,
        ...(input.phase === 'post' ? { postConfirmedAt: input.now } : {}),
        retractedAt: null,
        retractedReason: null,
        updatedAt: input.now,
      };
      if (prev) {
        await tx.update(matchChannel).set(values).where(eq(matchChannel.id, prev.id));
        result.updated++;
        if (prev.status !== 'confirmed' || prev.channelName !== values.channelName) result.changed = true;
      } else {
        await tx.insert(matchChannel).values({
          eventId: input.eventId,
          countryCode: country,
          broadcasterId: a.broadcasterId,
          firstConfirmedAt: input.now,
          createdAt: input.now,
          ...values,
        });
        result.inserted++;
        result.changed = true;
      }
    }
    if (input.accepted.some((a) => a.sourceKind === 'official')) {
      const keep = new Set(input.accepted.map((a) => a.broadcasterId));
      for (const r of current) {
        if (keep.has(r.broadcasterId) || r.status !== 'confirmed' || r.sourceKind !== 'press') continue;
        await tx
          .update(matchChannel)
          .set({
            status: 'retracted',
            retractedAt: input.now,
            retractedReason: 'a fonte oficial confirmou o jogo em outro canal',
            updatedAt: input.now,
          })
          .where(eq(matchChannel.id, r.id));
        result.retracted++;
        result.changed = true;
      }
    }
    if (result.changed)
      await notifyChange(tx as unknown as Database, input.eventId, country, {
        reason: 'match_channel',
        window: input.window,
      });
  });
  return result;
}

// ─── momento do jogo e texto ─────────────────────────────────────────────────────────────────────

/** Momento do jogo para o onde assistir: antes, ao vivo ou encerrado. */
export type MatchPhase = 'pre' | 'live' | 'post';

/** Status do evento (core.event_status) → momento. Adiado e cancelado seguem "antes". */
export function matchPhaseOf(status: string): MatchPhase {
  if (status === 'live' || status === 'break' || status === 'suspended') return 'live';
  if (status === 'finished' || status === 'abandoned') return 'post';
  return 'pre';
}

/** Estado do canal do jogo: confirmado, a confirmar (antes/ao vivo) ou não confirmado (encerrado). */
export type MatchChannelState = 'confirmed' | 'to_confirm' | 'not_confirmed';

export function matchChannelState(phase: MatchPhase, confirmedChannels: number): MatchChannelState {
  if (confirmedChannels > 0) return 'confirmed';
  return phase === 'post' ? 'not_confirmed' : 'to_confirm';
}

interface ChannelTexts {
  pre: string;
  live: string;
  post: string;
  toConfirm: string;
  toConfirmHint: string;
  notConfirmed: string;
}

export const MATCH_CHANNEL_TEXTS: Record<'pt' | 'es', ChannelTexts> = {
  pt: {
    pre: 'Passa em {channels}',
    live: 'Ao vivo em {channels}',
    post: 'Transmitido por {channels}',
    toConfirm: 'Canal deste jogo a confirmar',
    toConfirmHint: 'O canal do jogo sai mais perto da partida.',
    notConfirmed: 'Não confirmamos o canal deste jogo',
  },
  es: {
    pre: 'Se ve por {channels}',
    live: 'En vivo por {channels}',
    post: 'Transmitido por {channels}',
    toConfirm: 'Canal de este partido a confirmar',
    toConfirmHint: 'El canal del partido se conoce más cerca del encuentro.',
    notConfirmed: 'No confirmamos el canal de este partido',
  },
};

/** "Globo, SporTV e Premiere" / "Globo, SporTV y Premiere". */
export function joinNames(names: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/**
 * Título e dica do bloco por momento do jogo. A dica "sai mais perto da partida" só antes do jogo:
 * ao vivo ou encerrado ela nunca aparece.
 */
export function matchChannelHeadline(
  state: MatchChannelState,
  phase: MatchPhase,
  names: string[],
  locale: string,
): { headline: string; hint: string | null } {
  const t = MATCH_CHANNEL_TEXTS[locale.startsWith('es') ? 'es' : 'pt'];
  if (state === 'confirmed')
    return { headline: t[phase].replace('{channels}', joinNames(names, locale)), hint: null };
  if (state === 'not_confirmed') return { headline: t.notConfirmed, hint: null };
  return { headline: t.toConfirm, hint: phase === 'pre' ? t.toConfirmHint : null };
}
