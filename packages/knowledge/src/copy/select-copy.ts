import {
  COPY_INTENTS,
  REVIEW_STATUSES,
  type AffinitySource,
  type AffinityType,
  type CompetitionContext,
  type CopyConfidence,
  type CopyIntent,
  type CopyPlaceholder,
  type Momentum,
  type ReviewStatus,
  type ToneIntensity,
} from '../types.js';

/** Template de copy normalizado (mesmo formato vindo do YAML ou de semantic.copy_template). */
export interface CopyTemplate {
  key: string;
  locale: string;
  sport: string;
  intent: CopyIntent;
  tone: ToneIntensity;
  template: string;
  affinityType: AffinityType | null;
  affinitySource: AffinitySource | null;
  momentum: Momentum | null;
  competitionContext: CompetitionContext | null;
  confidence: CopyConfidence;
  reviewStatus: ReviewStatus;
}

export interface CopyRequest {
  locale: string;
  sport: string;
  intent: CopyIntent;
  /** Relação do usuário com o time citado; null = público geral, sem afinidade conhecida. */
  affinityType?: AffinityType | null;
  /** explicit = declarada pelo usuário; inferred = deduzida de comportamento. */
  affinitySource?: AffinitySource | null;
  momentum?: Momentum | null;
  context?: CompetitionContext | null;
  tone: ToneIntensity;
  /**
   * Valores disponíveis para os placeholders. Quando informado, templates que dependem de um valor
   * ausente (ex.: {nickname} sem apelido conhecido) são descartados.
   */
  vars?: Partial<Record<CopyPlaceholder, string | number>>;
  /** Escolhe deterministicamente entre variantes equivalentes (ex.: id do usuário + id do evento). */
  variantSeed?: string;
  /** Status editorial mínimo aceito. Padrão: draft (em produção a API deve exigir approved). */
  minReviewStatus?: ReviewStatus;
}

export interface CopyPermission {
  allowedIntents: readonly CopyIntent[];
  maxTone: ToneIntensity;
  /** Motivo legível (pt-BR) da regra aplicada. */
  rule: string;
}

export interface CopySelection {
  template: CopyTemplate;
  /** Intenção efetivamente usada (pode cair para inform quando a pedida não é permitida). */
  intent: CopyIntent;
  /** Tom máximo permitido para o pedido (o template escolhido tem tom ≤ este). */
  tone: ToneIntensity;
  /** true quando a intenção ou o tom foram rebaixados pelo copy_permission. */
  downgraded: boolean;
  permission: CopyPermission;
  /** Texto pronto, quando `vars` cobre todos os placeholders. */
  text: string | null;
}

const NEUTRAL: readonly CopyIntent[] = ['inform', 'anticipate', 'urgency', 'decisive'];
const IDENTITY: readonly CopyIntent[] = ['inform', 'anticipate', 'cheer', 'urgency', 'decisive'];

/**
 * copy_permission — guardrail central (docs/06 §4.2).
 * - Afinidade inferida (qualquer tipo, inclusive rival): só copy informativa, tom 1.
 * - Rival declarado: rivalidade lúdica permitida; nunca torcida/identidade pelo rival.
 * - Coração declarado: identidade forte (até tom 4). Apoio: até tom 3. Simpatia/interesse: até tom 2.
 * - Sem afinidade conhecida: público geral, sem linguagem de identidade, até tom 2.
 */
export function copyPermission(
  affinityType: AffinityType | null | undefined,
  affinitySource: AffinitySource | null | undefined,
): CopyPermission {
  if (affinityType && affinitySource !== 'explicit')
    return {
      allowedIntents: ['inform'],
      maxTone: 1,
      rule: 'afinidade inferida (ou sem origem declarada): apenas copy informativa',
    };
  switch (affinityType) {
    case 'heart':
      return { allowedIntents: IDENTITY, maxTone: 4, rule: 'time do coração declarado: identidade forte' };
    case 'support':
      return { allowedIntents: IDENTITY, maxTone: 3, rule: 'apoio declarado: identidade moderada' };
    case 'sympathy':
      return { allowedIntents: IDENTITY, maxTone: 2, rule: 'simpatia declarada: tom próximo' };
    case 'interest':
      return {
        allowedIntents: NEUTRAL,
        maxTone: 2,
        rule: 'interesse declarado: sem linguagem de identidade',
      };
    case 'rival':
      return {
        allowedIntents: ['inform', 'anticipate', 'rivalry', 'urgency'],
        maxTone: 3,
        rule: 'rival declarado: rivalidade lúdica conforme o mercado, nunca ofensa',
      };
    default:
      return { allowedIntents: NEUTRAL, maxTone: 2, rule: 'sem afinidade: copy para público geral' };
  }
}

const placeholdersOf = (template: string) => [...template.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]!);

/** Preenche os placeholders; retorna null se faltar algum valor (nunca exibir texto quebrado). */
export function renderCopy(
  template: string,
  vars: Partial<Record<string, string | number>> = {},
): string | null {
  let missing = false;
  const text = template.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') {
      missing = true;
      return '';
    }
    return String(v);
  });
  return missing ? null : text;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Escolhe a copy para um pedido respeitando o copy_permission. Função pura: recebe os templates.
 * Ordem de preferência: mesma intenção (ou inform, se rebaixada) → maior tom ≤ permitido →
 * mais específica (momentum/contexto/afinidade iguais aos do pedido) → variante pelo `variantSeed`.
 * Não existe fallback entre locales (copy é localizada pela intenção, não traduzida).
 */
export function selectCopy(request: CopyRequest, templates: readonly CopyTemplate[]): CopySelection | null {
  if (!(COPY_INTENTS as readonly string[]).includes(request.intent)) return null;
  const permission = copyPermission(request.affinityType, request.affinitySource);
  const maxTone = Math.max(1, Math.min(request.tone, permission.maxTone)) as ToneIntensity;
  const intentAllowed = permission.allowedIntents.includes(request.intent);
  const minStatus = REVIEW_STATUSES.indexOf(request.minReviewStatus ?? 'draft');

  const pool = templates.filter(
    (t) =>
      t.locale === request.locale &&
      t.sport === request.sport &&
      REVIEW_STATUSES.indexOf(t.reviewStatus) >= minStatus &&
      t.tone <= maxTone &&
      // template restrito a outra afinidade/momento/contexto não serve
      (t.affinityType === null || t.affinityType === (request.affinityType ?? null)) &&
      (t.affinitySource === null || t.affinitySource === (request.affinitySource ?? null)) &&
      (t.momentum === null || t.momentum === (request.momentum ?? null)) &&
      (t.competitionContext === null || t.competitionContext === (request.context ?? null)) &&
      (!request.vars ||
        placeholdersOf(t.template).every((p) => request.vars?.[p as CopyPlaceholder] != null)),
  );

  const attempt = (intent: CopyIntent): CopySelection | null => {
    const candidates = pool.filter((t) => t.intent === intent);
    if (!candidates.length) return null;
    const score = (t: CopyTemplate) =>
      t.tone * 100 +
      (t.momentum ? 10 : 0) +
      (t.competitionContext ? 10 : 0) +
      (t.affinityType ? 5 : 0) +
      (t.affinitySource ? 1 : 0);
    const best = Math.max(...candidates.map(score));
    const top = candidates.filter((t) => score(t) === best).sort((a, b) => a.key.localeCompare(b.key));
    const template = top[request.variantSeed ? hash(request.variantSeed) % top.length : 0]!;
    return {
      template,
      intent,
      tone: maxTone,
      downgraded: intent !== request.intent || maxTone < request.tone,
      permission,
      text: request.vars ? renderCopy(template.template, request.vars) : null,
    };
  };

  return (intentAllowed ? attempt(request.intent) : null) ?? attempt('inform');
}
