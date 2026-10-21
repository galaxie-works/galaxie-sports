import type { LocatedTeam } from '../load.js';
import { isSecondaryTeam, nameSimilarity, normalizeName, stateSuffix } from './normalize.js';

/** Time candidato vindo da api-sports (raw) e/ou de core.participant. */
export interface Candidate {
  apiId: number | null;
  participantId: string | null;
  name: string;
  code: string | null;
  /** Nome do país como a api-sports escreve ("Brazil", "England"). */
  countryName: string | null;
  /** ISO2 (ou GB-ENG) quando conhecido. */
  countryCode: string | null;
  founded: number | null;
  national: boolean | null;
  venueCity: string | null;
  /** De onde veio: teams (raw /teams), fixtures (raw /fixtures), participant (core). */
  source: 'teams' | 'fixtures' | 'participant';
}

export interface CandidatePool {
  candidates: Candidate[];
  /** Países (nome normalizado da api-sports) com a lista completa de /teams?country= no raw. */
  coveredCountries: Set<string>;
}

/** Dados do YAML usados no casamento. */
export interface TeamRef {
  slug: string;
  file: string;
  kind: 'club' | 'national_team';
  countryCode: string;
  countryName: string;
  currentId: number | null;
  /** Variantes de nome com peso (match.name pesa mais que apelidos). */
  names: { value: string; weight: number }[];
  city: string | null;
  region: string | null;
  foundedYear: number | null;
  abbreviation: string | null;
}

export type ResolutionStatus =
  | 'verified' // team_id do YAML confere com nome e país
  | 'conflict' // team_id do YAML aponta para outro clube/país (ou não existe no país coberto)
  | 'unverified' // team_id do YAML sem dados locais para conferir
  | 'resolved' // sem team_id; um único candidato com confiança alta
  | 'ambiguous' // sem team_id; candidatos próximos demais — revisão manual
  | 'unmatched' // sem team_id; nenhum candidato razoável no país coberto
  | 'no-data'; // sem team_id e sem dados do país no raw/core

export interface ScoredCandidate {
  apiId: number | null;
  participantId: string | null;
  name: string;
  country: string | null;
  source: Candidate['source'];
  confidence: number;
}

export interface Resolution {
  slug: string;
  file: string;
  kind: TeamRef['kind'];
  countryCode: string;
  matchName: string;
  currentId: number | null;
  status: ResolutionStatus;
  /** ID a usar (verificado ou resolvido); null nos demais casos. */
  apiId: number | null;
  participantId: string | null;
  confidence: number | null;
  candidates: ScoredCandidate[];
  note: string | null;
}

export interface ResolveOptions {
  /** Confiança mínima para resolver automaticamente (padrão 0,85). */
  autoThreshold?: number;
  /** Diferença mínima para o segundo colocado (padrão 0,1). */
  margin?: number;
  /** Abaixo disto o candidato nem aparece no relatório (padrão 0,65). */
  floor?: number;
  /** Confiança exigida quando o país não tem a lista completa de /teams no raw (padrão 0,97). */
  exactThreshold?: number;
}

/** Extrai do YAML o que o resolvedor precisa. */
export function teamRef(t: LocatedTeam): TeamRef {
  const e = t.entry;
  const names: TeamRef['names'] = [
    { value: e.api_sports.match.name, weight: 1 },
    { value: e.names.short, weight: 0.98 },
    { value: e.names.official, weight: 0.96 },
    ...Object.values(e.labels ?? {}).flatMap((v) => (v ? [{ value: v, weight: 0.95 }] : [])),
    ...(e.nicknames ?? []).map((v) => ({ value: v, weight: 0.75 })),
  ];
  const year = e.founded ? Number(e.founded.slice(0, 4)) : null;
  return {
    slug: e.slug,
    file: t.file,
    kind: t.kind,
    countryCode: t.countryCode,
    countryName: e.api_sports.match.country,
    currentId: e.api_sports.team_id ?? null,
    names,
    city: e.city ?? e.stadium?.city ?? null,
    region: e.region ?? null,
    foundedYear: Number.isFinite(year) ? year : null,
    abbreviation: e.names.abbreviation ?? null,
  };
}

const sameCountry = (team: TeamRef, c: Candidate) =>
  (c.countryCode !== null && c.countryCode === team.countryCode) ||
  (c.countryName !== null && normalizeName(c.countryName) === normalizeName(team.countryName));

/** Confiança 0–1 de que o candidato é o time do YAML. */
export function scoreCandidate(team: TeamRef, c: Candidate): number {
  let score = Math.max(...team.names.map((n) => n.weight * nameSimilarity(n.value, c.name)));
  if (team.foundedYear && c.founded)
    score += team.foundedYear === c.founded ? 0.05 : Math.abs(team.foundedYear - c.founded) > 1 ? -0.1 : 0;
  if (team.city && c.venueCity && normalizeName(c.venueCity).includes(normalizeName(team.city)))
    score += 0.05;
  if (team.abbreviation && c.code && team.abbreviation.toUpperCase() === c.code.toUpperCase()) score += 0.03;
  const suffix = stateSuffix(c.name);
  if (suffix && team.countryCode === 'BR' && team.region)
    score += suffix === team.region.toLowerCase() ? 0.05 : -0.2;
  // sem teto: bônus (fundação, cidade, sigla) desempatam nomes idênticos; a confiança exibida é limitada a 1
  return Math.max(0, Math.round(score * 1000) / 1000);
}

const display = (score: number) => Math.min(1, score);

function eligible(team: TeamRef, c: Candidate): boolean {
  if (!sameCountry(team, c)) return false;
  // seleção só casa com time marcado como seleção; clube nunca casa com seleção
  if (team.kind === 'national_team' ? c.national !== true : c.national === true) return false;
  if (isSecondaryTeam(c.name)) return false;
  return true;
}

const view = (c: Candidate, confidence: number): ScoredCandidate => ({
  apiId: c.apiId,
  participantId: c.participantId,
  name: c.name,
  country: c.countryName ?? c.countryCode,
  source: c.source,
  confidence: display(confidence),
});

/** Casa cada time do YAML com os candidatos (função pura). Nunca resolve automaticamente um caso ambíguo. */
export function resolveTeams(
  teams: TeamRef[],
  pool: CandidatePool,
  options: ResolveOptions = {},
): Resolution[] {
  const auto = options.autoThreshold ?? 0.85;
  const margin = options.margin ?? 0.1;
  const floor = options.floor ?? 0.65;
  const exact = options.exactThreshold ?? 0.97;
  const byId = new Map<number, Candidate>();
  for (const c of pool.candidates) if (c.apiId !== null && !byId.has(c.apiId)) byId.set(c.apiId, c);

  return teams.map((team): Resolution => {
    const base = {
      slug: team.slug,
      file: team.file,
      kind: team.kind,
      countryCode: team.countryCode,
      matchName: team.names[0]?.value ?? team.slug,
      currentId: team.currentId,
    };
    const covered = pool.coveredCountries.has(normalizeName(team.countryName));
    const ranked = pool.candidates
      .filter((c) => eligible(team, c))
      .map((c) => ({ c, s: scoreCandidate(team, c) }))
      .filter((x) => x.s >= floor)
      .sort((a, b) => b.s - a.s || (a.c.apiId ?? 0) - (b.c.apiId ?? 0));
    // o mesmo clube pode vir do raw e do core: mantém uma entrada por apiId/participante
    const seen = new Set<string>();
    const deduped = ranked.filter(({ c }) => {
      const key = c.apiId !== null ? `api:${c.apiId}` : `p:${c.participantId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // o ranking de IDs só considera quem tem ID da api-sports; participantes sem ID entram à parte
    const unique = deduped.filter(({ c }) => c.apiId !== null);
    const top = unique.slice(0, 3).map(({ c, s }) => view(c, s));
    /**
     * Participante do core ainda sem mapeamento da api-sports (ex.: criado por outro provedor) que
     * casa sem ambiguidade com o time — permite gravar provider_map para ele.
     */
    const unmappedParticipant = () => {
      const list = deduped.filter(({ c }) => c.apiId === null && c.participantId !== null);
      const [first, next] = list;
      return first && first.s >= auto && (!next || first.s - next.s >= margin - 1e-9)
        ? first.c.participantId
        : null;
    };

    if (team.currentId !== null) {
      const c = byId.get(team.currentId);
      if (!c) {
        return {
          ...base,
          status: covered ? 'conflict' : 'unverified',
          apiId: covered ? null : team.currentId,
          participantId: null,
          confidence: null,
          candidates: top,
          note: covered
            ? `team_id ${team.currentId} não aparece em /teams?country=${team.countryName}`
            : 'sem dados locais deste país para conferir',
        };
      }
      const s = scoreCandidate(team, c);
      // país desconhecido na fonte (ex.: partida de competição "World") não é conflito: confere só o nome
      const countryUnknown = c.countryName === null && c.countryCode === null;
      const countryOk = countryUnknown || sameCountry(team, c);
      const ok = countryOk && s >= floor && !isSecondaryTeam(c.name);
      return {
        ...base,
        status: ok ? 'verified' : 'conflict',
        apiId: ok ? team.currentId : null,
        participantId: c.participantId ?? (ok ? unmappedParticipant() : null),
        confidence: display(s),
        candidates: ok ? [view(c, s)] : top,
        note: ok
          ? countryUnknown
            ? 'país não informado na fonte; conferido só pelo nome'
            : null
          : `team_id ${team.currentId} é "${c.name}" (${c.countryName ?? c.countryCode ?? '?'}), confiança ${display(s)}`,
      };
    }

    if (!unique.length)
      return {
        ...base,
        status: covered ? 'unmatched' : 'no-data',
        apiId: null,
        participantId: null,
        confidence: null,
        candidates: [],
        note: null,
      };
    const best = unique[0]!;
    const second = unique[1];
    // sem a lista completa do país, só resolve nome praticamente idêntico (outros homônimos podem faltar)
    const clear = best.s >= (covered ? auto : exact) && (!second || best.s - second.s >= margin - 1e-9);
    return {
      ...base,
      status: clear ? 'resolved' : 'ambiguous',
      apiId: clear ? best.c.apiId : null,
      participantId: clear ? (best.c.participantId ?? unmappedParticipant()) : null,
      confidence: display(best.s),
      candidates: top,
      note: clear
        ? null
        : best.s < (covered ? auto : exact)
          ? covered
            ? `melhor candidato abaixo de ${auto}`
            : `país sem lista completa no raw; exige nome idêntico (≥ ${exact})`
          : `diferença para o 2º colocado menor que ${margin}`,
    };
  });
}

export function summarizeResolutions(list: Resolution[]): Record<ResolutionStatus, number> {
  const out: Record<ResolutionStatus, number> = {
    verified: 0,
    conflict: 0,
    unverified: 0,
    resolved: 0,
    ambiguous: 0,
    unmatched: 0,
    'no-data': 0,
  };
  for (const r of list) out[r.status]++;
  return out;
}
