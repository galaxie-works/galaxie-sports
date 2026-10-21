/**
 * Validador determinístico do onde assistir (docs/07 §2.2) — a IA sugere, o código decide.
 *
 * 1. Descarta opções sem URL de evidência acessível (e tudo o que a blocklist editorial pega).
 * 2. Normaliza emissora/canal contra o dicionário do país; nome desconhecido → revisão (`pending`).
 * 3. Deduplica por (região, emissora, meio), juntando as evidências.
 * 4. Confiança: primária (emissora/organizador) 0,9 · imprensa 0,7 · agregador/desconhecida 0,4 ·
 *    +0,1 consistente com a tabela de direitos · −0,2 fora da tabela · +0,1 duas fontes independentes ·
 *    −0,3 fonte com mais de 72 h em competição com escolha por rodada. Limite [0, 1].
 * 5. Publica (`confirmed`) se ≥ 0,7; `pending` entre 0,5 e 0,7; descarta abaixo de 0,5.
 *    Conflito entre fontes primárias → `omitted`.
 */
import type { AccessModel, BroadcastMedium, BroadcastStatus, Evidence, SourceKind } from '@galaxie/db';
import type { CountryDirectory } from './config/directory.js';
import type { BroadcasterEntry } from './config/types.js';
import { clipExcerpt, hostOf, isHttpUrl, normalizeName, registrableDomain } from './normalize.js';

export const SOURCE_SCORES: Record<SourceKind, number> = {
  broadcaster: 0.9,
  organizer: 0.9,
  editorial: 1,
  press: 0.7,
  aggregator: 0.4,
  unknown: 0.4,
};

export const SCORING = {
  rightsConsistent: 0.1,
  rightsMismatch: -0.2,
  independentSources: 0.1,
  staleSource: -0.3,
  staleHours: 72,
  publishThreshold: 0.7,
  pendingThreshold: 0.5,
} as const;

/** UFs do Brasil — região válida para TV aberta regional. */
export const BR_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]; // prettier-ignore

/** Evidência proposta pelo agente, enriquecida pela verificação HTTP (fetch). */
export interface CandidateEvidence {
  url: string;
  excerpt: string;
  publishedAt?: string | null;
  stance?: 'confirms' | 'denies';
  /** true = página respondeu 2xx · false = falhou · null/undefined = não buscada (agregador). */
  accessible?: boolean | null;
  /** A página menciona a emissora (nome, alias ou canal)? null = não verificado. */
  mentionsBroadcaster?: boolean | null;
  contentHash?: string | null;
  fetchedAt?: string;
}

/** Opção proposta pelo agente (saída do LLM já validada pelo JSON Schema). */
export interface Candidate {
  broadcaster: string;
  channel?: string | null;
  medium?: BroadcastMedium | null;
  accessModel?: AccessModel | null;
  region?: string | null;
  watchUrl?: string | null;
  language?: string | null;
  evidence: CandidateEvidence[];
}

export interface ValidationContext {
  directory: CountryDirectory;
  competitionSlug: string | null;
  eventStartsAt: Date;
  now: Date;
  publishThreshold?: number;
  pendingThreshold?: number;
}

export interface ScoreBreakdown {
  base: number;
  rights: number;
  independent: number;
  stale: number;
}

export interface ValidatedOption {
  /** Chave de dedupe: região|emissora|meio. */
  key: string;
  broadcasterId: string | null;
  providerName: string;
  channel: string | null;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  region: string | null;
  url: string | null;
  language: string | null;
  status: Extract<BroadcastStatus, 'confirmed' | 'pending' | 'omitted'>;
  confidence: number;
  conflict: boolean;
  flags: string[];
  sourceKind: SourceKind | null;
  evidence: Evidence[];
  score: ScoreBreakdown;
}

export interface DiscardedOption {
  broadcaster: string;
  reason: 'blocked' | 'no_accessible_evidence' | 'low_confidence' | 'denied_by_primary' | 'invalid_region';
  confidence?: number;
}

export interface ValidationReport {
  options: ValidatedOption[];
  discarded: DiscardedOption[];
}

const PRIMARY: SourceKind[] = ['broadcaster', 'organizer', 'editorial'];

/** Chave de dedupe compartilhada com o versionamento (store). */
export function optionKey(o: {
  region: string | null;
  broadcasterId: string | null;
  providerName: string;
  medium: string;
}): string {
  const who = o.broadcasterId ?? `unknown:${normalizeName(o.providerName)}`;
  return `${o.region ?? 'national'}|${who}|${o.medium}`;
}

/** Região: null = nacional. No Brasil só UFs; demais países aceitam o texto informado. */
export function normalizeRegion(
  region: string | null | undefined,
  country: string,
): string | null | undefined {
  if (!region) return null;
  const r = region.trim();
  if (!r || /^(national|nacional|todo o pa[ií]s|todo el pa[ií]s|brasil|nationwide)$/i.test(r)) return null;
  if (country === 'BR') {
    const uf = r.toUpperCase();
    return BR_UFS.includes(uf) ? uf : undefined;
  }
  return r.slice(0, 40);
}

interface Group {
  entry: BroadcasterEntry | null;
  providerName: string;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  region: string | null;
  channels: { value: string; kind: SourceKind }[];
  watchUrl: string | null;
  language: string | null;
  flags: Set<string>;
  support: Map<string, Evidence & { score: number }>;
  denials: Map<string, Evidence & { score: number }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Aplica as regras e devolve as opções com status e confiança (função pura). */
export function validateCandidates(candidates: Candidate[], ctx: ValidationContext): ValidationReport {
  const { directory: dir } = ctx;
  const publish = ctx.publishThreshold ?? SCORING.publishThreshold;
  const pendingMin = ctx.pendingThreshold ?? SCORING.pendingThreshold;
  const discarded: DiscardedOption[] = [];
  const groups = new Map<string, Group>();

  for (const c of candidates) {
    const name = c.broadcaster.trim();
    // Política editorial: nome ou URL bloqueados → a opção nunca chega à API (e não registramos o nome).
    if (
      !name ||
      dir.blocklist.isBlockedName(name) ||
      (c.channel && dir.blocklist.isBlockedName(c.channel)) ||
      (c.watchUrl && dir.blocklist.isBlockedUrl(c.watchUrl))
    ) {
      discarded.push({ broadcaster: '[bloqueado]', reason: 'blocked' });
      continue;
    }
    const resolved = dir.resolve(name) ?? (c.channel ? dir.resolve(c.channel) : null);
    if (resolved && dir.blocklist.isBlockedName(resolved.entry.name)) {
      discarded.push({ broadcaster: '[bloqueado]', reason: 'blocked' });
      continue;
    }
    const entry = resolved?.entry ?? null;

    let region = normalizeRegion(c.region, dir.country);
    if (region === undefined) {
      discarded.push({ broadcaster: name, reason: 'invalid_region' });
      continue;
    }
    if (resolved?.region) region = resolved.region;

    const medium: BroadcastMedium = entry?.medium ?? c.medium ?? 'pay_tv';
    const accessModel: AccessModel = entry?.accessModel ?? c.accessModel ?? 'unknown';
    const providerName = entry?.name ?? name.slice(0, 80);
    const key = optionKey({ region, broadcasterId: entry?.id ?? null, providerName, medium });

    let g = groups.get(key);
    if (!g) {
      g = {
        entry,
        providerName,
        medium,
        accessModel,
        region,
        channels: [],
        watchUrl: null,
        language: c.language ?? (dir.language || null),
        flags: new Set(),
        support: new Map(),
        denials: new Map(),
      };
      groups.set(key, g);
    }
    if (!entry) g.flags.add('unknown_broadcaster');
    if (!g.watchUrl && isHttpUrl(c.watchUrl) && !dir.isAggregator(c.watchUrl)) g.watchUrl = c.watchUrl;
    const channel = resolved?.channel ?? (c.channel?.trim() || null);

    for (const ev of c.evidence) {
      if (!isHttpUrl(ev.url) || dir.blocklist.isBlockedUrl(ev.url)) continue;
      // Pista sem verificação (agregador não raspado) ou URL que falhou: não sustenta a opção.
      if (ev.accessible !== true) continue;
      const kind = dir.classifySource(ev.url, entry);
      let score = SOURCE_SCORES[kind];
      if (ev.mentionsBroadcaster === false) {
        // Página não menciona a emissora: rebaixa ao nível de agregador (anti-alucinação).
        score = Math.min(score, SOURCE_SCORES.aggregator);
        g.flags.add('excerpt_not_found');
      }
      const evidence: Evidence & { score: number } = {
        url: ev.url,
        excerpt: clipExcerpt(ev.excerpt ?? ''),
        publisher: hostOf(ev.url)!,
        fetchedAt: ev.fetchedAt ?? ctx.now.toISOString(),
        sourceKind: kind,
        publishedAt: ev.publishedAt ?? null,
        contentHash: ev.contentHash ?? null,
        stance: ev.stance ?? 'confirms',
        score,
      };
      if (ev.stance === 'denies') g.denials.set(ev.url, evidence);
      else {
        const prev = g.support.get(ev.url);
        if (!prev || prev.score < score) g.support.set(ev.url, evidence);
        if (channel) g.channels.push({ value: channel, kind });
      }
    }
  }

  const options: ValidatedOption[] = [];
  const rights = dir.rightsFor(ctx.competitionSlug, ctx.eventStartsAt);

  for (const [key, g] of groups) {
    const support = [...g.support.values()];
    const denials = [...g.denials.values()];
    if (!support.length) {
      discarded.push({
        broadcaster: g.providerName,
        reason: denials.length ? 'denied_by_primary' : 'no_accessible_evidence',
      });
      continue;
    }
    const primarySupport = support.some((e) => e.sourceKind && PRIMARY.includes(e.sourceKind));
    const primaryDenial = denials.some((e) => e.sourceKind && PRIMARY.includes(e.sourceKind));
    if (primaryDenial && !primarySupport) {
      discarded.push({ broadcaster: g.providerName, reason: 'denied_by_primary' });
      continue;
    }

    // Canal: primárias divergentes = conflito; senão o canal da melhor fonte.
    const primaryChannels = new Set(
      g.channels.filter((c) => PRIMARY.includes(c.kind)).map((c) => normalizeName(c.value)),
    );
    const conflict = (primaryDenial && primarySupport) || primaryChannels.size > 1;
    const bestChannel =
      [...g.channels].sort((a, b) => SOURCE_SCORES[b.kind] - SOURCE_SCORES[a.kind])[0]?.value ?? null;

    const score: ScoreBreakdown = {
      base: Math.max(...support.map((e) => e.score)),
      rights: 0,
      independent: 0,
      stale: 0,
    };
    if (rights && g.entry) {
      if (rights.holders.includes(g.entry.id)) score.rights = SCORING.rightsConsistent;
      else if (!rights.uncertainHolders.includes(g.entry.id)) {
        score.rights = SCORING.rightsMismatch;
        g.flags.add('rights_mismatch');
      }
    }
    const domains = new Set(support.map((e) => registrableDomain(hostOf(e.url)!)));
    if (domains.size >= 2) score.independent = SCORING.independentSources;
    if (rights?.perRoundSelection) {
      const dated = support.map((e) => (e.publishedAt ? Date.parse(e.publishedAt) : NaN));
      if (dated.every((t) => Number.isFinite(t))) {
        const freshest = Math.max(...dated);
        if (ctx.now.getTime() - freshest > SCORING.staleHours * 3600_000) {
          score.stale = SCORING.staleSource;
          g.flags.add('stale_source');
        }
      }
    }
    const confidence = round2(
      Math.min(1, Math.max(0, score.base + score.rights + score.independent + score.stale)),
    );

    let status: ValidatedOption['status'];
    if (conflict) {
      status = 'omitted';
      g.flags.add('conflict');
    } else if (confidence < pendingMin) {
      discarded.push({ broadcaster: g.providerName, reason: 'low_confidence', confidence });
      continue;
    } else if (!g.entry || confidence < publish) status = 'pending';
    else status = 'confirmed';

    const best = [...support].sort((a, b) => b.score - a.score)[0]!;
    options.push({
      key,
      broadcasterId: g.entry?.id ?? null,
      providerName: g.providerName,
      channel:
        bestChannel && normalizeName(bestChannel) !== normalizeName(g.providerName) ? bestChannel : null,
      medium: g.medium,
      accessModel: g.accessModel,
      region: g.region,
      url: g.watchUrl,
      language: g.language,
      status,
      confidence,
      conflict,
      flags: [...g.flags].sort(),
      sourceKind: best.sourceKind ?? null,
      evidence: [...support, ...denials].sort((a, b) => b.score - a.score).map(({ score: _s, ...e }) => e),
      score,
    });
  }

  options.sort((a, b) => a.key.localeCompare(b.key));
  return { options, discarded };
}
