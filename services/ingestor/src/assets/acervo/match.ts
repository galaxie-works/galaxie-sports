/**
 * Mapeamento conservador dos logos do acervo para os nossos times e competições (função pura). Casa
 * só dentro do mesmo país, pela melhor similaridade entre o nome do logo e os nomes do alvo (nome,
 * nome curto e, para times, apelidos da base semântica), com o normalizador da base semântica
 * (acentos, "FC", "CF", "Club"...). Na dúvida não mapeia: dois candidatos próximos viram `ambiguous`
 * para a curadoria, e nada abaixo do limiar automático é ligado.
 */
import { isSecondaryTeam, nameSimilarity, stateSuffix } from '@galaxie/knowledge';
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
}

export interface MatchInput {
  key: string;
  kind: AcervoKind;
  country: string;
  name: string;
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

export function matchLogo(logo: MatchInput, targets: MatchTarget[], options: MatchOptions = {}): MatchResult {
  const auto = options.auto ?? 0.9;
  const margin = options.margin ?? 0.1;
  const floor = options.floor ?? 0.75;
  const secondaryLogo = isSecondaryTeam(logo.name);
  const ranked = targets
    .filter((t) => t.kind === logo.kind && sameCountry(logo.country, t.country))
    // base, feminino e time B só casam com logo que também seja de base, feminino ou B
    .filter((t) => logo.kind !== 'team' || isSecondaryTeam(t.name) === secondaryLogo)
    .map((t) => ({ t, s: scoreTarget(logo, t) }))
    .filter((x) => x.s >= floor)
    .sort((x, y) => y.s - x.s || x.t.name.localeCompare(y.t.name) || x.t.id.localeCompare(y.t.id));
  const candidates = ranked.slice(0, 5).map(({ t, s }) => ({ id: t.id, name: t.name, confidence: s }));
  const [first, second] = ranked;
  if (!first) return { status: 'unmatched', targetId: null, targetName: null, confidence: null, candidates };
  if (first.s >= auto && (!second || first.s - second.s >= margin - 1e-9))
    return {
      status: 'auto',
      targetId: first.t.id,
      targetName: first.t.name,
      confidence: first.s,
      candidates: [],
    };
  return { status: 'ambiguous', targetId: null, targetName: null, confidence: first.s, candidates };
}
