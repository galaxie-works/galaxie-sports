/**
 * Regras puras da moderação da Cosmos (#997), sem banco: recursos, régua, escada de autonomia, validação e leitura
 * dentro do teto da Galaxie. A tela do cliente usa as mesmas regras (subcaminho `@galaxie/cosmos/moderation-rules`);
 * a gravação e o histórico ficam em `moderation-config.ts`.
 *
 * - Recursos: cada um desligado por padrão. A Leitura total (ler todas as mensagens, não só as denunciadas ou marcadas
 *   pela Lista proibida) é opção paga, também desligada.
 * - Régua 0 a 4: um nível geral e o ajuste por categoria. Apostas e conteúdo sexual com menores ficam travados no
 *   máximo, sem régua.
 * - Escada por ação: esconder e silenciar sobem até "age sozinha", dentro do teto da Galaxie (Ajustes); suspender e
 *   banir ficam em "só sinaliza", porque pedem pessoa. A Cosmos nunca aplica Silêncio oculto: a ação nem existe aqui.
 */
import { isTenantRole, type TenantRole } from '@galaxie/engage';

/** Degraus da escada de autonomia: só sinaliza, age e avisa, age sozinha. */
export const AUTONOMY_STEPS = ['flag', 'notify', 'auto'] as const;
export type AutonomyStep = (typeof AUTONOMY_STEPS)[number];

/** Teto da Galaxie para a moderação da Cosmos (Ajustes): o cliente escolhe dentro dele. */
export interface ModerationCeiling {
  hide: AutonomyStep;
  mute: AutonomyStep;
  /** Horas máximas de um Silêncio aplicado pela Cosmos (1 a 24). */
  muteHours: number;
}

/** O que a Cosmos pode moderar. Tudo desligado por padrão. */
export const MODERATION_FEATURES = [
  'live_chat',
  'communities',
  'images',
  'appeals',
  'room_report',
  'full_read',
] as const;
export type ModerationFeature = (typeof MODERATION_FEATURES)[number];

/** Categorias com régua. */
export const MODERATION_CATEGORIES = [
  'offense',
  'hate',
  'harassment',
  'sexual',
  'spam',
  'personal_data',
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** Travadas no máximo, sem régua: links e menções a casas de aposta; conteúdo sexual envolvendo menores. */
export const LOCKED_CATEGORIES = ['betting', 'minors'] as const;
export type LockedCategory = (typeof LOCKED_CATEGORIES)[number];

export const MODERATION_LEVEL_MAX = 4;
export type ModerationLevel = 0 | 1 | 2 | 3 | 4;

export const MODERATION_ACTIONS = ['hide', 'mute', 'suspend', 'ban'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Degrau mais alto de cada ação, antes do teto da Galaxie. Suspender e banir pedem pessoa. */
export const ACTION_MAX_STEP: Record<ModerationAction, AutonomyStep> = {
  hide: 'auto',
  mute: 'auto',
  suspend: 'flag',
  ban: 'flag',
};

/** Texto que o torcedor vê no lugar do conteúdo escondido. */
export const HIDDEN_NOTICE_MAX = 150;
export const MUTE_HOURS_MAX = 24;

export interface ModerationConfig {
  features: Record<ModerationFeature, boolean>;
  /** Nível geral da régua. */
  level: ModerationLevel;
  /** Ajuste por categoria; sem entrada, vale o nível geral. */
  categories: Partial<Record<ModerationCategory, ModerationLevel>>;
  autonomy: Record<ModerationAction, AutonomyStep>;
  /** Duração do Silêncio aplicado pela Cosmos, em horas. */
  muteHours: number;
  /** Cargos da equipe cujo conteúdo a Cosmos só sinaliza (nunca esconde nem silencia sozinha). */
  exemptRoles: TenantRole[];
  /** null = o texto padrão do produto. */
  hiddenNotice: string | null;
  /**
   * Público infantil: toda imagem que a triagem local não segurou também passa pela Cosmos (a triagem não vê droga,
   * arma nem ódio). Opcional no envio; sem ele, false.
   */
  childAudience: boolean;
}

/**
 * Exceção de uma sala ou comunidade: só o que muda em relação ao cliente. Os ajustes por categoria somam aos do
 * cliente (a exceção troca o nível de uma categoria, não apaga o ajuste herdado); o nível geral da exceção vale para
 * as categorias sem ajuste em nenhum dos dois.
 */
export type ModerationOverride = Partial<ModerationConfig> & {
  features?: Partial<Record<ModerationFeature, boolean>>;
  autonomy?: Partial<Record<ModerationAction, AutonomyStep>>;
};

/** Padrão (decisão D4): esconde e avisa; silenciar também age e avisa; suspender e banir só sinalizam. */
export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  features: Object.fromEntries(MODERATION_FEATURES.map((f) => [f, false])) as Record<
    ModerationFeature,
    boolean
  >,
  level: 2,
  categories: {},
  autonomy: { hide: 'notify', mute: 'notify', suspend: 'flag', ban: 'flag' },
  muteHours: MUTE_HOURS_MAX,
  exemptRoles: [],
  hiddenNotice: null,
  childAudience: false,
};

const stepRank = (step: AutonomyStep) => AUTONOMY_STEPS.indexOf(step);
/** O degrau cabe no máximo? */
export const stepAllowed = (step: AutonomyStep, max: AutonomyStep) => stepRank(step) <= stepRank(max);
const minStep = (a: AutonomyStep, b: AutonomyStep): AutonomyStep => (stepRank(a) <= stepRank(b) ? a : b);

/** Degrau mais alto que o cliente pode escolher para a ação, com o teto da Galaxie. */
export function maxStepFor(action: ModerationAction, ceiling: ModerationCeiling): AutonomyStep {
  const fixed = ACTION_MAX_STEP[action];
  if (action === 'hide') return minStep(fixed, ceiling.hide);
  if (action === 'mute') return minStep(fixed, ceiling.mute);
  return fixed;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isLevel = (v: unknown): v is ModerationLevel =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MODERATION_LEVEL_MAX;
const isStep = (v: unknown): v is AutonomyStep =>
  typeof v === 'string' && (AUTONOMY_STEPS as readonly string[]).includes(v);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const CONFIG_KEYS = [
  'features',
  'level',
  'categories',
  'autonomy',
  'muteHours',
  'exemptRoles',
  'hiddenNotice',
  'childAudience',
] as const;

/**
 * Valida uma configuração vinda do cliente. `partial` (exceção de sala ou comunidade) aceita só parte dos campos.
 * Recusa campo desconhecido, categoria travada com régua, degrau acima do teto e Silêncio além do teto de horas.
 * Os erros são caminhos estáveis (`autonomy.suspend`), para a tela apontar o campo.
 */
export function parseModerationConfig(
  input: unknown,
  ceiling: ModerationCeiling,
  options: { partial: true },
): ParseResult<ModerationOverride>;
export function parseModerationConfig(
  input: unknown,
  ceiling: ModerationCeiling,
  options?: { partial?: false },
): ParseResult<ModerationConfig>;
export function parseModerationConfig(
  input: unknown,
  ceiling: ModerationCeiling,
  options: { partial?: boolean } = {},
): ParseResult<ModerationConfig | ModerationOverride> {
  const partial = options.partial === true;
  if (!isObject(input)) return { ok: false, errors: ['config'] };
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) errors.push(key);
  const has = (key: (typeof CONFIG_KEYS)[number]) => input[key] !== undefined;
  const need = (key: (typeof CONFIG_KEYS)[number]) => {
    if (!partial && !has(key)) errors.push(key);
    return has(key);
  };

  if (need('features')) {
    const f = input.features;
    if (!isObject(f)) errors.push('features');
    else {
      const features: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(f)) {
        if (!(MODERATION_FEATURES as readonly string[]).includes(k) || typeof v !== 'boolean')
          errors.push(`features.${k}`);
        else features[k] = v;
      }
      if (!partial) for (const k of MODERATION_FEATURES) if (!(k in features)) errors.push(`features.${k}`);
      out.features = features;
    }
  }
  if (need('level')) {
    if (!isLevel(input.level)) errors.push('level');
    else out.level = input.level;
  }
  if (need('categories')) {
    const c = input.categories;
    if (!isObject(c)) errors.push('categories');
    else {
      const categories: Record<string, ModerationLevel> = {};
      for (const [k, v] of Object.entries(c)) {
        // travada (apostas, menores) ou desconhecida: não tem régua
        if (!(MODERATION_CATEGORIES as readonly string[]).includes(k) || !isLevel(v))
          errors.push(`categories.${k}`);
        else categories[k] = v;
      }
      out.categories = categories;
    }
  }
  if (need('autonomy')) {
    const a = input.autonomy;
    if (!isObject(a)) errors.push('autonomy');
    else {
      const autonomy: Record<string, AutonomyStep> = {};
      for (const [k, v] of Object.entries(a)) {
        const action = k as ModerationAction;
        if (
          !(MODERATION_ACTIONS as readonly string[]).includes(k) ||
          !isStep(v) ||
          stepRank(v) > stepRank(maxStepFor(action, ceiling))
        )
          errors.push(`autonomy.${k}`);
        else autonomy[k] = v;
      }
      if (!partial)
        for (const k of MODERATION_ACTIONS)
          if (!(k in autonomy) && !errors.includes(`autonomy.${k}`)) errors.push(`autonomy.${k}`);
      out.autonomy = autonomy;
    }
  }
  if (need('muteHours')) {
    const h = input.muteHours;
    if (!Number.isInteger(h) || (h as number) < 1 || (h as number) > ceiling.muteHours)
      errors.push('muteHours');
    else out.muteHours = h;
  }
  if (need('exemptRoles')) {
    const r = input.exemptRoles;
    if (!Array.isArray(r) || !r.every(isTenantRole)) errors.push('exemptRoles');
    else out.exemptRoles = [...new Set(r)];
  }
  if (need('hiddenNotice')) {
    const n = input.hiddenNotice;
    if (n === null) out.hiddenNotice = null;
    else if (typeof n !== 'string' || n.trim().length > HIDDEN_NOTICE_MAX) errors.push('hiddenNotice');
    else out.hiddenNotice = n.trim() || null;
  }
  // opcional mesmo na configuração inteira: quem já salvava sem ele continua valendo
  if (has('childAudience')) {
    if (typeof input.childAudience !== 'boolean') errors.push('childAudience');
    else out.childAudience = input.childAudience;
  } else if (!partial) out.childAudience = false;
  // o campo `hiddenNotice` aceita null de propósito; `need` só cobra presença
  return errors.length > 0
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, value: out as unknown as ModerationConfig };
}

/**
 * Lê o que está gravado sem confiar no formato (versão antiga, edição manual): o que não valer cai no padrão, e o
 * degrau acima do teto atual desce até ele. Nunca devolve suspensão ou banimento automáticos.
 */
export function normalizeModerationConfig(
  stored: unknown,
  ceiling: ModerationCeiling,
  base: ModerationConfig = DEFAULT_MODERATION_CONFIG,
): ModerationConfig {
  const s = isObject(stored) ? stored : {};
  const features = { ...base.features };
  if (isObject(s.features))
    for (const k of MODERATION_FEATURES) if (typeof s.features[k] === 'boolean') features[k] = s.features[k];
  const categories: ModerationConfig['categories'] = { ...base.categories };
  if (isObject(s.categories))
    for (const k of MODERATION_CATEGORIES) if (isLevel(s.categories[k])) categories[k] = s.categories[k];
  const autonomy = { ...base.autonomy };
  for (const k of MODERATION_ACTIONS) {
    const v = isObject(s.autonomy) ? s.autonomy[k] : undefined;
    const chosen = isStep(v) ? v : autonomy[k];
    autonomy[k] = minStep(chosen, maxStepFor(k, ceiling));
  }
  const hours = Number.isInteger(s.muteHours) ? (s.muteHours as number) : base.muteHours;
  return {
    features,
    level: isLevel(s.level) ? s.level : base.level,
    categories,
    autonomy,
    muteHours: Math.max(1, Math.min(hours, ceiling.muteHours)),
    exemptRoles: Array.isArray(s.exemptRoles)
      ? [...new Set(s.exemptRoles.filter(isTenantRole))]
      : base.exemptRoles,
    hiddenNotice:
      s.hiddenNotice === null
        ? null
        : typeof s.hiddenNotice === 'string' && s.hiddenNotice.trim().length <= HIDDEN_NOTICE_MAX
          ? s.hiddenNotice.trim() || null
          : base.hiddenNotice,
    // a sala ou comunidade pode ligar o público infantil, nunca desligar o que o cliente ligou
    childAudience: base.childAudience || s.childAudience === true,
  };
}

/** Régua efetiva de uma categoria: travada vale o máximo; sem ajuste, o nível geral. */
export function categoryLevel(
  config: ModerationConfig,
  category: ModerationCategory | LockedCategory,
): ModerationLevel {
  if ((LOCKED_CATEGORIES as readonly string[]).includes(category)) return MODERATION_LEVEL_MAX;
  return config.categories[category as ModerationCategory] ?? config.level;
}

/**
 * Degrau que a Cosmos aplica numa ação para um autor. Conteúdo de cargo isento só é sinalizado. O motor (#998) chama
 * isto antes de agir, e o teto da Galaxie vale de novo aqui.
 */
export function stepFor(
  config: ModerationConfig,
  action: ModerationAction,
  ceiling: ModerationCeiling,
  authorRole?: TenantRole | null,
): AutonomyStep {
  if (authorRole && config.exemptRoles.includes(authorRole)) return 'flag';
  return minStep(config.autonomy[action], maxStepFor(action, ceiling));
}
