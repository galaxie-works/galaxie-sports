/**
 * Mapeamento conservador dos logos do acervo para os nossos times e competições (função pura), pela
 * melhor similaridade entre o nome do logo e os nomes do alvo (nome, nome curto e, para times, nomes e
 * apelidos da base semântica), com o normalizador da base semântica (acentos, "FC", "CF", "Club"...).
 * Três caminhos, do mais forte para o mais fraco:
 *
 * 1. seleção: o país do logo ("Seleção - País de Gales") aponta a seleção principal daquele país;
 * 2. competição: quando o pacote diz de que competição é a pasta, casa entre os times que jogam nela
 *    (lista fechada de 20 a 40 times: aceita nome traduzido, "Bayern de Munique" × "Bayern München",
 *    desde que o vencedor fique bem à frente do segundo);
 * 3. país: o resto casa dentro do mesmo país, com limiar alto.
 *
 * Na dúvida não mapeia: dois candidatos próximos viram `ambiguous` para a curadoria, e nada abaixo do
 * limiar é ligado.
 */
import { coreTokens, isSecondaryTeam, nameSimilarity, stateSuffix } from '@galaxie/knowledge';
import type { AcervoCandidate, AcervoKind, MatchStatus } from './manifest.js';

export interface MatchTarget {
  id: string;
  kind: AcervoKind;
  /** Código do país; null/WORLD = internacional. */
  country: string | null;
  /** Nome principal (exibido no relatório). */
  name: string;
  /** Variantes com peso: nome e nome curto pesam 1; apelidos, menos. */
  names: { value: string; weight: number }[];
  /** Seleção (participant.kind = national_team). */
  national?: boolean;
  /** Seleção principal: o nome é o do país ("France", não "France Aizenay" nem "France U21"). */
  mainNational?: boolean;
  /** Competições (ids) em que o time tem jogos no banco. */
  competitions?: ReadonlySet<string>;
}

export interface MatchInput {
  key: string;
  kind: AcervoKind;
  country: string;
  name: string;
  /** Escudo de seleção; `nationalCountry` é o país dela (resolvido do nome). */
  national?: boolean;
  nationalCountry?: string | null;
  /** Competições (ids) da pasta do pacote: restringe os candidatos aos times que jogam nelas. */
  competitionIds?: readonly string[];
}

export interface MatchResult {
  status: Extract<MatchStatus, 'auto' | 'ambiguous' | 'unmatched'>;
  targetId: string | null;
  targetName: string | null;
  confidence: number | null;
  candidates: AcervoCandidate[];
}

export interface MatchOptions {
  /** Confiança mínima para ligar sozinho (padrão 0,9). */
  auto?: number;
  /** Folga mínima sobre o segundo candidato (padrão 0,1, a mesma do resolvedor da base semântica). */
  margin?: number;
  /** Abaixo disto o candidato nem aparece (padrão 0,75). */
  floor?: number;
}

/** Limiares dentro da lista fechada de uma competição: forte (≥ 0,8, folga 0,1) ou bem destacado (≥ 0,6, folga 0,25). */
const POOL_STRONG = { score: 0.8, margin: 0.1 };
const POOL_CLEAR = { score: 0.6, margin: 0.25 };
const POOL_FLOOR = 0.5;

/**
 * Os dois nomes têm uma palavra com o mesmo começo (3 letras): "Bayern de Munique" × "Bayern München",
 * "Copenhague" × "FC Copenhagen". Exigido na faixa de confiança baixa, onde nomes parecidos só no
 * sufixo ("Konyaspor" × "Alanyaspor") não podem ligar.
 */
export function shareWordStart(a: string, b: string): boolean {
  const ta = coreTokens(a).filter((t) => t.length >= 3);
  const tb = coreTokens(b).filter((t) => t.length >= 3);
  return ta.some((x) => tb.some((y) => x.slice(0, 3) === y.slice(0, 3)));
}

const international = (c: string | null) => c === null || c === 'WORLD';

export function sameCountry(a: string | null, b: string | null): boolean {
  return international(a) ? international(b) : a === b;
}

/**
 * Ajuste do sufixo de estado no Brasil, por variante de nome: mesmo estado desempata ("America RN" ×
 * "America RN"), estado diferente derruba ("America RN" × "America MG") e sufixo de um lado só pesa
 * contra — "Flamengo" é o Flamengo, não o Flamengo SE (Sergipe), que o normalizador lê como
 * "Sociedade Esportiva". Vale por variante: "Atletico-MG" ainda casa pelo nome oficial da base semântica.
 */
function suffixAdjust(logo: MatchInput, value: string): number {
  if (logo.country !== 'BR') return 0;
  const a = stateSuffix(logo.name);
  const b = stateSuffix(value);
  if (a && b) return a === b ? 0.03 : -0.3;
  return a || b ? -0.1 : 0;
}

/** Confiança 0–1 de que o alvo é o dono do logo: a melhor variante de nome, com peso e ajuste. */
export function scoreTarget(logo: MatchInput, target: MatchTarget): number {
  const score = Math.max(
    0,
    ...target.names.map((n) => n.weight * nameSimilarity(logo.name, n.value) + suffixAdjust(logo, n.value)),
  );
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

const view = (ranked: { t: MatchTarget; s: number }[]) =>
  ranked.slice(0, 5).map(({ t, s }) => ({ id: t.id, name: t.name, confidence: s }));

const auto = (t: MatchTarget, s: number): MatchResult => ({
  status: 'auto',
  targetId: t.id,
  targetName: t.name,
  confidence: s,
  candidates: [],
});

const rank = (logo: MatchInput, targets: MatchTarget[], floor: number) =>
  targets
    .map((t) => ({ t, s: scoreTarget(logo, t) }))
    .filter((x) => x.s >= floor)
    .sort((x, y) => y.s - x.s || x.t.name.localeCompare(y.t.name) || x.t.id.localeCompare(y.t.id));

export function matchLogo(logo: MatchInput, targets: MatchTarget[], options: MatchOptions = {}): MatchResult {
  const minAuto = options.auto ?? 0.9;
  const margin = options.margin ?? 0.1;
  const floor = options.floor ?? 0.75;
  const secondaryLogo = isSecondaryTeam(logo.name);
  const national = logo.kind === 'team' && !!logo.national;
  const eligible = targets.filter(
    (t) =>
      t.kind === logo.kind &&
      // clube só casa com clube e seleção com seleção; base, feminino e B só com logo do mesmo tipo
      (logo.kind !== 'team' || (!!t.national === national && isSecondaryTeam(t.name) === secondaryLogo)),
  );
  const none: MatchResult = {
    status: 'unmatched',
    targetId: null,
    targetName: null,
    confidence: null,
    candidates: [],
  };

  // 1. seleção: a seleção principal do país do escudo
  if (national) {
    if (!logo.nationalCountry) return none;
    const all = eligible.filter((t) => t.country === logo.nationalCountry);
    // mais de uma "seleção" no cadastro do país (clubes cadastrados como seleção): vale a principal
    const main = all.filter((t) => t.mainNational);
    const list = main.length ? main : all;
    if (list.length === 1) return auto(list[0]!, 1);
    if (!list.length) return none;
    const ranked = rank(logo, list, 0);
    return {
      status: 'ambiguous',
      targetId: null,
      targetName: null,
      confidence: ranked[0]?.s ?? null,
      candidates: view(ranked),
    };
  }

  // 2. competição: lista fechada dos times que jogam nela
  if (logo.competitionIds?.length) {
    const wanted = new Set(logo.competitionIds);
    const pool = eligible.filter((t) => [...(t.competitions ?? [])].some((c) => wanted.has(c)));
    const ranked = rank(logo, pool, POOL_FLOOR);
    const [first, second] = ranked;
    if (first) {
      const gap = first.s - (second?.s ?? 0);
      if (
        (first.s >= POOL_STRONG.score && gap >= POOL_STRONG.margin - 1e-9) ||
        (first.s >= POOL_CLEAR.score &&
          gap >= POOL_CLEAR.margin - 1e-9 &&
          first.t.names.some((n) => shareWordStart(logo.name, n.value)))
      )
        return auto(first.t, first.s);
      return {
        status: 'ambiguous',
        targetId: null,
        targetName: null,
        confidence: first.s,
        candidates: view(ranked),
      };
    }
    // nenhum candidato na competição (time que subiu, temporada que o banco ainda não tem): tenta o país
  }

  // 3. país: limiar alto
  const ranked = rank(
    logo,
    eligible.filter((t) => sameCountry(logo.country, t.country)),
    floor,
  );
  const [first, second] = ranked;
  if (!first) return none;
  if (first.s >= minAuto && (!second || first.s - second.s >= margin - 1e-9)) return auto(first.t, first.s);
  return {
    status: 'ambiguous',
    targetId: null,
    targetName: null,
    confidence: first.s,
    candidates: view(ranked),
  };
}
