/**
 * Prioridade de uma chamada ao LLM pela competição (#357), com o que o repositório já sabe:
 * - `p0`: futebol LATAM — audiência ≥ AI_P0_MIN_AUDIENCE (padrão 25) em algum mercado de
 *   config/geo/market-audience.yaml, ou listada em `competitions.p0` de config/ai-policy.yaml;
 * - `p1`: o resto do futebol que o produto cobre — audiência acima de 0 (as europeias, a Concachampions
 *   no México) ou listada em `competitions.p1`;
 * - `rest`: o resto (sem audiência na região, outro esporte, chamada sem competição).
 * A prioridade escolhe a faixa de orçamento da chamada e, no resumo e no cenário, a ordem da fila e se o
 * evento usa LLM (só P0 e P1; o resto sai com o texto determinístico).
 */
import { defaultAiPolicyFile, loadAiPolicyOrEmpty, type AiPolicy, type AiPriority } from '@galaxie/ai-ledger';
import { loadGeoConfig, type MarketAudience } from '@galaxie/geo';

export type { AiPriority } from '@galaxie/ai-ledger';

/** Competição de uma chamada ou evento (`sport` ausente = futebol, o único esporte com audiência hoje). */
export interface CompetitionRef {
  sport?: string | null;
  slug: string;
}

export type PriorityResolver = (competition: CompetitionRef | null | undefined) => AiPriority;

/** Ordem da fila: P0, depois P1, depois o resto. */
export const PRIORITY_RANK: Readonly<Record<AiPriority, number>> = { p0: 0, p1: 1, rest: 2 };

/** Prioridades em que o resumo e o cenário usam o LLM. */
export const LLM_PRIORITIES: readonly AiPriority[] = ['p0', 'p1'];

export function competitionPriority(
  competition: CompetitionRef | null | undefined,
  ctx: { audience: MarketAudience | null; policy: Pick<AiPolicy, 'competitions'>; minAudience: number },
): AiPriority {
  if (!competition?.slug) return 'rest';
  if (ctx.policy.competitions.p0.includes(competition.slug)) return 'p0';
  if (ctx.policy.competitions.p1.includes(competition.slug)) return 'p1';
  const sport = competition.sport ?? 'football';
  const audience = ctx.audience;
  const best = audience
    ? Math.max(0, ...audience.markets().map((m) => audience.points(m, sport, competition.slug)))
    : 0;
  if (best >= ctx.minAudience) return 'p0';
  return best > 0 ? 'p1' : 'rest';
}

let geoAudience: MarketAudience | null | undefined;

/** Audiência de config/geo (cache do processo); sem o arquivo, null (só as exceções da política valem). */
function defaultAudience(): MarketAudience | null {
  if (geoAudience === undefined) {
    try {
      geoAudience = loadGeoConfig().audience;
    } catch (err) {
      console.warn(
        `[política de IA] audiência por mercado indisponível (${err instanceof Error ? err.message : String(err)}): só as exceções de config/ai-policy.yaml dão P0/P1.`,
      );
      geoAudience = null;
    }
  }
  return geoAudience;
}

/** Resolvedor com a política versionada, a audiência de config/geo e o corte do painel. */
export function priorityResolver(opts: {
  minAudience: number;
  policy?: AiPolicy;
  audience?: MarketAudience | null;
  env?: Record<string, string | undefined>;
}): PriorityResolver {
  const policy = opts.policy ?? loadAiPolicyOrEmpty(defaultAiPolicyFile(opts.env));
  const audience = opts.audience !== undefined ? opts.audience : defaultAudience();
  return (competition) =>
    competitionPriority(competition, { audience, policy, minAudience: opts.minAudience });
}
