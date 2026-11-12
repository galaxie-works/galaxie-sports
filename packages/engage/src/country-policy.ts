/**
 * Ficha por país (#954; arquitetura 01). Uma ficha por país, mantida pela Galaxie em Ajustes → Conformidade → Ficha
 * por país, que todos os módulos leem no servidor. País novo é ficha nova, sem código novo. O cliente marca os países onde
 * opera e só pode endurecer a ficha (`hardenPolicy`).
 *
 * Qual ficha vale (`resolvePolicy`): a do país do torcedor (no token); sem ficha própria, a de "demais da América
 * Latina" se o país for da região; senão, a `DEFAULT` (restritiva, para quem vem de fora, como um torcedor europeu);
 * só sem `DEFAULT` cai no país principal do cliente.
 *
 * Idade e responsável (#1104, épico #1103): a ficha diz a partir de que idade o responsável autoriza, quando a conta
 * fica vinculada à dele, que comprovação de idade vale por recurso e se o menor é ouvido antes da autorização.
 *
 * Os valores iniciais são de produto e ainda passam pelo advogado (as leis de referência estão em `laws`).
 */

/** Chave da ficha: ISO 3166-1 alfa-2, o grupo "demais da América Latina" ou a ficha `DEFAULT`. */
export const LATAM_POLICY_KEY = 'LATAM';
/** Ficha de quem não tem ficha do país nem cai na LATAM (#1104): restritiva, no lugar do país principal do cliente. */
export const DEFAULT_POLICY_KEY = 'DEFAULT';
export type PolicyKey = string;

export const isPolicyKey = (value: unknown): value is PolicyKey =>
  typeof value === 'string' &&
  (/^[A-Z]{2}$/.test(value) || value === LATAM_POLICY_KEY || value === DEFAULT_POLICY_KEY);

/** Países da América Latina e do Caribe hispânico que caem na ficha LATAM quando não têm ficha própria. */
export const LATAM_COUNTRIES: readonly string[] = [
  'AR',
  'BO',
  'BR',
  'CL',
  'CO',
  'CR',
  'CU',
  'DO',
  'EC',
  'GT',
  'HN',
  'MX',
  'NI',
  'PA',
  'PE',
  'PR',
  'PY',
  'SV',
  'UY',
  'VE',
];

export const POLICY_ENTITIES = ['ltda', 'llc'] as const;
export type PolicyEntity = (typeof POLICY_ENTITIES)[number];

export const POLICY_LANGUAGES = ['pt-BR', 'es', 'en', 'fr-CA'] as const;
export type PolicyLanguage = (typeof POLICY_LANGUAGES)[number];

/** Comprovação de idade, da mais fraca à mais forte: declarada, estimada, verificada (#1109). */
export const AGE_ASSURANCE_LEVELS = ['self', 'estimated', 'verified'] as const;
export type AgeAssuranceLevel = (typeof AGE_ASSURANCE_LEVELS)[number];
/** Recursos com comprovação própria: os sociais e o conteúdo impróprio para menores. */
export const AGE_ASSURANCE_FEATURES = ['social', 'restrictedContent'] as const;
export type AgeAssuranceFeature = (typeof AGE_ASSURANCE_FEATURES)[number];

/** A comprovação `a` vale pelo menos tanto quanto `b`? */
export const assuranceAtLeast = (a: AgeAssuranceLevel, b: AgeAssuranceLevel): boolean =>
  AGE_ASSURANCE_LEVELS.indexOf(a) >= AGE_ASSURANCE_LEVELS.indexOf(b);

export interface CountryPolicy {
  /** Idade mínima para escrever texto livre (18 em todos). */
  minAgeWrite: number;
  /** Idade mínima para participar (13; abaixo, nenhum recurso social, COPPA). */
  minAgeParticipate: number;
  /** Três relógios de retenção (D5), em dias. O cliente só encurta o de conteúdo removido. */
  retention: { accessLogDays: number; removedContentDays: number; moderationDecisionsDays: number };
  /** Quem contrata: a Ltda (Brasil e Latam) ou a LLC (EUA e Canadá). */
  entity: PolicyEntity;
  /** ISO 4217. */
  currency: string;
  /** Padrão date-fns (`dd/MM/yyyy`). */
  dateFormat: string;
  /** Fuso IANA padrão. */
  timeZone: string;
  /** Idiomas das listas de palavras e dos textos legais. */
  languages: PolicyLanguage[];
  /** Publicidade para menores permitida (B10). */
  adsToMinors: boolean;
  /** Portão jurídico da Gamificação (#940, #917). */
  gamification: { materialExchange: boolean; marketplace: boolean; raffle: boolean };
  /** Campanha com prêmio (#945): valor máximo na moeda do país (null = sem teto da ficha). */
  prizeCampaign: { maxValue: number | null; excludedRegions: string[]; legalClassificationRequired: boolean };
  /** Aviso de punição obrigatório: desliga o Silêncio oculto no país. */
  punishmentNoticeRequired: boolean;
  /** Leis de referência (a confirmar com o advogado). */
  laws: string[];
  /** Abaixo desta idade, só com autorização do responsável (13 a 18; nunca menor que `minAgeParticipate`). */
  parentalConsentUnder: number;
  /** Abaixo desta idade, a conta fica vinculada à do responsável, com painel de supervisão (null = não exige). */
  guardianLinkRequiredUnder: number | null;
  /** Comprovação mínima de idade por recurso. */
  ageAssuranceMin: Record<AgeAssuranceFeature, AgeAssuranceLevel>;
  /** O fluxo registra a manifestação do menor antes da autorização (Colômbia). */
  hearMinor: boolean;
  /** Prazo para pedir a autorização de novo, em dias (null = sem prazo). */
  consentRenewalDays: number | null;
  /**
   * O país aceita odds, anúncio ou link de casa de apostas (#1115). Mesmo com `true`, o torcedor só vê esse
   * conteúdo se o cliente tiver licença de operador para o país aprovada pela Galaxie (`bettingContentAllowed`).
   * `false` = proibido no país (Brasil, MP 1.394/2026), ou fechado até a Galaxie liberar.
   */
  bettingContent: boolean;
  /** Marketing por canal (#1115): `opt-in` exige consentimento prévio; `opt-out` envia até o torcedor recusar. */
  marketingConsent: Record<MarketingChannel, MarketingConsentMode>;
  /**
   * Guarda, em dias, do conteúdo removido que foi denunciado às autoridades (#1115). Conta da denúncia e fica fora
   * do relógio `retention.removedContentDays`.
   */
  legalHoldDays: number;
}

/** Canais de marketing com consentimento próprio (#1115). */
export const MARKETING_CHANNELS = ['email', 'push', 'sms'] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export const MARKETING_CONSENT_MODES = ['opt-in', 'opt-out'] as const;
export type MarketingConsentMode = (typeof MARKETING_CONSENT_MODES)[number];

/** Regras jurídicas da revisão de 11/11 que não são de idade (#1115). */
export type PolicyLegalRules = Pick<CountryPolicy, 'bettingContent' | 'marketingConsent' | 'legalHoldDays'>;

/**
 * Regras jurídicas mais protetivas: valem para a ficha `DEFAULT` e para completar uma ficha gravada antes do #1115
 * (`withLegalRules`). Guarda legal longa protege a investigação; o resto fica fechado.
 */
export const STRICT_LEGAL_RULES: Readonly<PolicyLegalRules> = {
  bettingContent: false,
  marketingConsent: { email: 'opt-in', push: 'opt-in', sms: 'opt-in' },
  legalHoldDays: 365,
};

/** Regras de idade de uma ficha (#1104). */
export type PolicyAgeRules = Pick<
  CountryPolicy,
  | 'parentalConsentUnder'
  | 'guardianLinkRequiredUnder'
  | 'ageAssuranceMin'
  | 'hearMinor'
  | 'consentRenewalDays'
>;

/**
 * Regras de idade mais protetivas: valem para a ficha `DEFAULT` e para completar uma ficha gravada antes do #1104
 * (`withAgeRules`), para nenhum campo ausente afrouxar o portão.
 */
export const STRICT_AGE_RULES: Readonly<PolicyAgeRules> = {
  parentalConsentUnder: 18,
  guardianLinkRequiredUnder: 18,
  ageAssuranceMin: { social: 'estimated', restrictedContent: 'verified' },
  hearMinor: true,
  consentRenewalDays: null,
};

const BASE = {
  minAgeWrite: 18,
  minAgeParticipate: 13,
  retention: { accessLogDays: 183, removedContentDays: 90, moderationDecisionsDays: 730 },
  adsToMinors: false,
  gamification: { materialExchange: false, marketplace: false, raffle: false },
  prizeCampaign: { maxValue: null, excludedRegions: [], legalClassificationRequired: true },
  punishmentNoticeRequired: false,
  guardianLinkRequiredUnder: null,
  ageAssuranceMin: { social: 'self', restrictedContent: 'self' },
  hearMinor: false,
  consentRenewalDays: null,
  bettingContent: false,
  marketingConsent: { email: 'opt-in', push: 'opt-in', sms: 'opt-in' },
  legalHoldDays: 180,
} satisfies Partial<CountryPolicy>;

const latam = (
  currency: string,
  timeZone: string,
  laws: string[],
  parentalConsentUnder: number,
  extra: Partial<CountryPolicy> = {},
): CountryPolicy => ({
  ...structuredClone(BASE),
  parentalConsentUnder,
  entity: 'ltda',
  currency,
  dateFormat: 'dd/MM/yyyy',
  timeZone,
  languages: ['es'],
  laws,
  ...extra,
});

/**
 * Fichas iniciais (Brasil, Argentina, México, Colômbia, Chile, Peru, demais da América Latina, EUA, Canadá e a
 * `DEFAULT`). As regras de idade (#1104) são as sugeridas pela revisão jurídica, a confirmar com o advogado.
 */
export const INITIAL_COUNTRY_POLICIES: Readonly<Record<PolicyKey, CountryPolicy>> = {
  BR: latam(
    'BRL',
    'America/Sao_Paulo',
    ['ECA Digital (Lei 15.211/2025)', 'LGPD (Lei 13.709/2018)', 'Marco Civil da Internet (Lei 12.965/2014)'],
    16,
    {
      languages: ['pt-BR'],
      guardianLinkRequiredUnder: 16,
      ageAssuranceMin: { social: 'estimated', restrictedContent: 'verified' },
    },
  ),
  AR: latam(
    'ARS',
    'America/Argentina/Buenos_Aires',
    ['Ley 25.326 de Protección de los Datos Personales'],
    16,
  ),
  MX: latam(
    'MXN',
    'America/Mexico_City',
    ['Ley Federal de Protección de Datos Personales en Posesión de los Particulares (2025)'],
    18,
  ),
  CO: latam('COP', 'America/Bogota', ['Ley 1581 de 2012 (Habeas Data)'], 18, { hearMinor: true }),
  CL: latam('CLP', 'America/Santiago', ['Ley 19.628', 'Ley 21.719 (vigente desde dic. 2026)'], 14),
  PE: latam('PEN', 'America/Lima', ['Ley 29733 de Protección de Datos Personales'], 14),
  [LATAM_POLICY_KEY]: latam(
    'USD',
    'America/Panama',
    ['Leis locais de proteção de dados (a confirmar por país)'],
    18,
    { hearMinor: true },
  ),
  US: {
    ...structuredClone(BASE),
    parentalConsentUnder: 13,
    entity: 'llc',
    currency: 'USD',
    dateFormat: 'MM/dd/yyyy',
    timeZone: 'America/New_York',
    languages: ['en'],
    laws: ['COPPA', 'Leis estaduais de privacidade (CCPA/CPRA e outras)'],
    // CAN-SPAM: e-mail é opt-out; TCPA: SMS só com consentimento prévio por escrito
    marketingConsent: { email: 'opt-out', push: 'opt-in', sms: 'opt-in' },
    // 18 U.S.C. § 2258A (REPORT Act): 1 ano do que foi reportado ao NCMEC
    legalHoldDays: 365,
  },
  CA: {
    ...structuredClone(BASE),
    parentalConsentUnder: 14,
    entity: 'llc',
    currency: 'CAD',
    dateFormat: 'yyyy-MM-dd',
    timeZone: 'America/Toronto',
    languages: ['en'],
    laws: ['PIPEDA', 'Lei 25 do Quebec'],
  },
  // torcedor de país sem ficha, fora da LATAM (por exemplo, da União Europeia): tudo no mais protetivo
  [DEFAULT_POLICY_KEY]: {
    ...structuredClone(BASE),
    ...structuredClone(STRICT_AGE_RULES),
    ...structuredClone(STRICT_LEGAL_RULES),
    punishmentNoticeRequired: true,
    entity: 'llc',
    currency: 'USD',
    dateFormat: 'yyyy-MM-dd',
    timeZone: 'UTC',
    languages: ['en'],
    laws: ['GDPR (UE) e leis locais de proteção de dados (a confirmar por país)'],
  },
};

/** Completa uma ficha gravada antes do #1104 com as regras de idade mais protetivas (campo ausente nunca afrouxa). */
export function withAgeRules(p: CountryPolicy): CountryPolicy {
  const partial = p as Partial<CountryPolicy>;
  if (
    partial.parentalConsentUnder !== undefined &&
    partial.guardianLinkRequiredUnder !== undefined &&
    partial.ageAssuranceMin !== undefined &&
    partial.hearMinor !== undefined &&
    partial.consentRenewalDays !== undefined
  )
    return p;
  const consent = partial.parentalConsentUnder ?? STRICT_AGE_RULES.parentalConsentUnder;
  const link =
    partial.guardianLinkRequiredUnder === undefined
      ? STRICT_AGE_RULES.guardianLinkRequiredUnder
      : partial.guardianLinkRequiredUnder;
  return {
    ...p,
    parentalConsentUnder: consent,
    // o vínculo nunca passa da idade da autorização (validatePolicy)
    guardianLinkRequiredUnder: link === null ? null : Math.min(link, consent),
    ageAssuranceMin: { ...STRICT_AGE_RULES.ageAssuranceMin, ...(partial.ageAssuranceMin ?? {}) },
    hearMinor: partial.hearMinor ?? STRICT_AGE_RULES.hearMinor,
    consentRenewalDays:
      partial.consentRenewalDays === undefined
        ? STRICT_AGE_RULES.consentRenewalDays
        : partial.consentRenewalDays,
  };
}

/** Completa uma ficha gravada antes do #1115 com as regras jurídicas mais protetivas (campo ausente nunca afrouxa). */
export function withLegalRules(p: CountryPolicy): CountryPolicy {
  const partial = p as Partial<CountryPolicy>;
  // null conta como ausente: guarda nula acabaria na hora da denúncia
  if (
    partial.bettingContent != null &&
    partial.legalHoldDays != null &&
    partial.marketingConsent != null &&
    MARKETING_CHANNELS.every((c) => partial.marketingConsent?.[c] != null)
  )
    return p;
  const consent: Partial<Record<MarketingChannel, MarketingConsentMode>> = {};
  for (const c of MARKETING_CHANNELS) {
    const v = partial.marketingConsent?.[c];
    if (v != null) consent[c] = v;
  }
  return {
    ...p,
    bettingContent: partial.bettingContent ?? STRICT_LEGAL_RULES.bettingContent,
    marketingConsent: { ...STRICT_LEGAL_RULES.marketingConsent, ...consent },
    legalHoldDays: partial.legalHoldDays ?? STRICT_LEGAL_RULES.legalHoldDays,
  };
}

/** Ficha completa: regras de idade (#1104) e jurídicas (#1115) que faltarem entram no mais protetivo. */
export const completePolicy = (p: CountryPolicy): CountryPolicy => withLegalRules(withAgeRules(p));

export type PolicyIssue = { path: string; message: string };

/** Ficha bem formada? Lista os problemas (vazia = ok). Vale para a ficha da Galaxie e para a efetiva do cliente. */
export function validatePolicy(p: CountryPolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const int = (path: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      issues.push({ path, message: `inteiro entre ${min} e ${max}` });
  };
  int('minAgeParticipate', p.minAgeParticipate, 13, 21);
  int('minAgeWrite', p.minAgeWrite, 13, 21);
  if (p.minAgeWrite < p.minAgeParticipate)
    issues.push({ path: 'minAgeWrite', message: 'não pode ser menor que a idade para participar' });
  int('retention.accessLogDays', p.retention?.accessLogDays, 1, 3650);
  int('retention.removedContentDays', p.retention?.removedContentDays, 1, 3650);
  int('retention.moderationDecisionsDays', p.retention?.moderationDecisionsDays, 1, 3650);
  if (!(POLICY_ENTITIES as readonly string[]).includes(p.entity))
    issues.push({ path: 'entity', message: 'ltda ou llc' });
  if (!/^[A-Z]{3}$/.test(p.currency ?? '')) issues.push({ path: 'currency', message: 'código ISO 4217' });
  if (typeof p.dateFormat !== 'string' || !/^[dMy/.\- ]{6,12}$/.test(p.dateFormat))
    issues.push({ path: 'dateFormat', message: 'formato como dd/MM/yyyy' });
  try {
    if (typeof p.timeZone !== 'string' || !p.timeZone) throw new RangeError('fuso vazio');
    new Intl.DateTimeFormat('en', { timeZone: p.timeZone });
  } catch {
    issues.push({ path: 'timeZone', message: 'fuso IANA' });
  }
  if (
    !Array.isArray(p.languages) ||
    p.languages.length === 0 ||
    p.languages.some((l) => !(POLICY_LANGUAGES as readonly string[]).includes(l))
  )
    issues.push({ path: 'languages', message: `um ou mais de ${POLICY_LANGUAGES.join(', ')}` });
  const mv = p.prizeCampaign?.maxValue;
  if (mv !== null && !(typeof mv === 'number' && Number.isFinite(mv) && mv >= 0))
    issues.push({ path: 'prizeCampaign.maxValue', message: 'vazio ou um valor positivo' });
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!strings(p.prizeCampaign?.excludedRegions))
    issues.push({ path: 'prizeCampaign.excludedRegions', message: 'lista de textos' });
  const bool = (path: string, v: unknown) => {
    if (typeof v !== 'boolean') issues.push({ path, message: 'sim ou não' });
  };
  bool('prizeCampaign.legalClassificationRequired', p.prizeCampaign?.legalClassificationRequired);
  bool('adsToMinors', p.adsToMinors);
  bool('punishmentNoticeRequired', p.punishmentNoticeRequired);
  bool('gamification.materialExchange', p.gamification?.materialExchange);
  bool('gamification.marketplace', p.gamification?.marketplace);
  bool('gamification.raffle', p.gamification?.raffle);
  if (!strings(p.laws)) issues.push({ path: 'laws', message: 'lista de textos' });
  // idade e responsável (#1104)
  int('parentalConsentUnder', p.parentalConsentUnder, 13, 18);
  // até 18: quem participa a partir de 19 a 21 já é maior de idade, e a autorização fica em 18
  if (Number.isInteger(p.parentalConsentUnder) && p.parentalConsentUnder < Math.min(18, p.minAgeParticipate))
    issues.push({ path: 'parentalConsentUnder', message: 'não pode ser menor que a idade para participar' });
  if (p.guardianLinkRequiredUnder !== null) {
    int('guardianLinkRequiredUnder', p.guardianLinkRequiredUnder, 13, 18);
    if (Number.isInteger(p.guardianLinkRequiredUnder) && p.guardianLinkRequiredUnder > p.parentalConsentUnder)
      issues.push({
        path: 'guardianLinkRequiredUnder',
        message: 'não pode passar da idade da autorização do responsável',
      });
  }
  for (const f of AGE_ASSURANCE_FEATURES)
    if (!(AGE_ASSURANCE_LEVELS as readonly string[]).includes(p.ageAssuranceMin?.[f] as string))
      issues.push({ path: `ageAssuranceMin.${f}`, message: AGE_ASSURANCE_LEVELS.join(', ') });
  bool('hearMinor', p.hearMinor);
  if (p.consentRenewalDays !== null) int('consentRenewalDays', p.consentRenewalDays, 30, 3650);
  // apostas, marketing e guarda legal (#1115)
  bool('bettingContent', p.bettingContent);
  for (const c of MARKETING_CHANNELS)
    if (!(MARKETING_CONSENT_MODES as readonly string[]).includes(p.marketingConsent?.[c] as string))
      issues.push({ path: `marketingConsent.${c}`, message: MARKETING_CONSENT_MODES.join(' ou ') });
  int('legalHoldDays', p.legalHoldDays, 30, 3650);
  return issues;
}

/**
 * Só os campos conhecidos da ficha, na ordem da interface: o que vem da tela ou de outro chamador nunca é
 * gravado cru (campo a mais fica de fora). Chamar depois de `validatePolicy` sem problemas.
 */
export function normalizePolicy(p: CountryPolicy): CountryPolicy {
  return {
    minAgeWrite: p.minAgeWrite,
    minAgeParticipate: p.minAgeParticipate,
    retention: {
      accessLogDays: p.retention.accessLogDays,
      removedContentDays: p.retention.removedContentDays,
      moderationDecisionsDays: p.retention.moderationDecisionsDays,
    },
    entity: p.entity,
    currency: p.currency,
    dateFormat: p.dateFormat,
    timeZone: p.timeZone,
    languages: [...p.languages],
    adsToMinors: p.adsToMinors,
    gamification: {
      materialExchange: p.gamification.materialExchange,
      marketplace: p.gamification.marketplace,
      raffle: p.gamification.raffle,
    },
    prizeCampaign: {
      maxValue: p.prizeCampaign.maxValue,
      excludedRegions: [...p.prizeCampaign.excludedRegions],
      legalClassificationRequired: p.prizeCampaign.legalClassificationRequired,
    },
    punishmentNoticeRequired: p.punishmentNoticeRequired,
    laws: [...p.laws],
    parentalConsentUnder: p.parentalConsentUnder,
    guardianLinkRequiredUnder: p.guardianLinkRequiredUnder,
    ageAssuranceMin: {
      social: p.ageAssuranceMin.social,
      restrictedContent: p.ageAssuranceMin.restrictedContent,
    },
    hearMinor: p.hearMinor,
    consentRenewalDays: p.consentRenewalDays,
    bettingContent: p.bettingContent,
    marketingConsent: {
      email: p.marketingConsent.email,
      push: p.marketingConsent.push,
      sms: p.marketingConsent.sms,
    },
    legalHoldDays: p.legalHoldDays,
  };
}

/**
 * Trava da Galaxie ao mudar uma ficha: nenhuma ficha baixa a idade de 18 para escrever sem decisão explícita
 * (`allowLowerWriteAge`), e 13 para participar é piso fixo (validatePolicy).
 */
export function policyChangeIssues(
  prev: CountryPolicy | null,
  next: CountryPolicy,
  opts: { allowLowerWriteAge?: boolean } = {},
): PolicyIssue[] {
  const issues = validatePolicy(next);
  const floor = Math.min(18, prev?.minAgeWrite ?? 18);
  if (next.minAgeWrite < floor && !opts.allowLowerWriteAge)
    issues.push({
      path: 'minAgeWrite',
      message: `baixar a idade para escrever abaixo de ${floor} exige decisão explícita`,
    });
  return issues;
}

/** O que o cliente pode mudar na ficha do país, sempre endurecendo. */
export interface PolicyHardening {
  minAgeWrite?: number;
  minAgeParticipate?: number;
  removedContentDays?: number;
  adsToMinors?: false;
  gamification?: Partial<Record<keyof CountryPolicy['gamification'], false>>;
  prizeMaxValue?: number;
  punishmentNoticeRequired?: true;
  /** Idade da autorização do responsável, só para cima (até 18). */
  parentalConsentUnder?: number;
  /** Conta vinculada ao responsável abaixo desta idade, só para cima (até a idade da autorização). */
  guardianLinkRequiredUnder?: number;
  /** Comprovação mais forte por recurso. */
  ageAssuranceMin?: Partial<Record<AgeAssuranceFeature, AgeAssuranceLevel>>;
  hearMinor?: true;
  /** Prazo de renovação da autorização, só mais curto. */
  consentRenewalDays?: number;
  /** Desliga o conteúdo de apostas no país, mesmo com licença. */
  bettingContent?: false;
  /** Canal que passa a exigir consentimento prévio. */
  marketingConsent?: Partial<Record<MarketingChannel, 'opt-in'>>;
}

/**
 * Aplica o que o cliente endureceu. Campo que afrouxa (idade menor, retenção maior, liberar o que a ficha
 * proíbe, teto de prêmio maior) é ignorado e devolvido em `rejected`.
 */
export function hardenPolicy(
  policy: CountryPolicy,
  h: PolicyHardening,
): { policy: CountryPolicy; rejected: string[] } {
  const out = structuredClone(completePolicy(policy));
  const rejected: string[] = [];
  const raise = (key: 'minAgeWrite' | 'minAgeParticipate') => {
    const v = h[key];
    if (v === undefined) return;
    if (Number.isInteger(v) && v >= out[key] && v <= 21) out[key] = v;
    else rejected.push(key);
  };
  raise('minAgeParticipate');
  raise('minAgeWrite');
  if (out.minAgeWrite < out.minAgeParticipate) out.minAgeWrite = out.minAgeParticipate;
  // a autorização do responsável nunca fica abaixo da idade para participar
  if (out.parentalConsentUnder < out.minAgeParticipate)
    out.parentalConsentUnder = Math.min(18, out.minAgeParticipate);
  if (h.removedContentDays !== undefined) {
    const v = h.removedContentDays;
    if (Number.isInteger(v) && v >= 1 && v <= out.retention.removedContentDays)
      out.retention.removedContentDays = v;
    else rejected.push('removedContentDays');
  }
  if (h.adsToMinors !== undefined) {
    if (h.adsToMinors === false) out.adsToMinors = false;
    else rejected.push('adsToMinors');
  }
  for (const [k, v] of Object.entries(h.gamification ?? {}) as [
    keyof CountryPolicy['gamification'],
    unknown,
  ][]) {
    if (v === false && k in out.gamification) out.gamification[k] = false;
    else rejected.push(`gamification.${k}`);
  }
  if (h.prizeMaxValue !== undefined) {
    const v = h.prizeMaxValue;
    const cap = out.prizeCampaign.maxValue;
    if (typeof v === 'number' && v >= 0 && (cap === null || v <= cap)) out.prizeCampaign.maxValue = v;
    else rejected.push('prizeMaxValue');
  }
  if (h.punishmentNoticeRequired !== undefined) {
    if (h.punishmentNoticeRequired === true) out.punishmentNoticeRequired = true;
    else rejected.push('punishmentNoticeRequired');
  }
  // idade e responsável (#1104): idade só sobe, comprovação só fica mais forte, prazo só encurta
  if (h.parentalConsentUnder !== undefined) {
    const v = h.parentalConsentUnder;
    if (Number.isInteger(v) && v >= out.parentalConsentUnder && v <= 18) out.parentalConsentUnder = v;
    else rejected.push('parentalConsentUnder');
  }
  if (h.guardianLinkRequiredUnder !== undefined) {
    const v = h.guardianLinkRequiredUnder;
    const cur = out.guardianLinkRequiredUnder;
    // acima da idade da autorização fica no teto (a ficha pode ter baixado depois que o cliente salvou)
    const capped = Number.isInteger(v) ? Math.min(v, out.parentalConsentUnder) : NaN;
    if (capped >= 13 && (cur === null || capped >= cur)) out.guardianLinkRequiredUnder = capped;
    else rejected.push('guardianLinkRequiredUnder');
  }
  for (const [k, v] of Object.entries(h.ageAssuranceMin ?? {}) as [AgeAssuranceFeature, unknown][]) {
    const known = (AGE_ASSURANCE_FEATURES as readonly string[]).includes(k);
    const level = (AGE_ASSURANCE_LEVELS as readonly unknown[]).includes(v) ? (v as AgeAssuranceLevel) : null;
    if (known && level && assuranceAtLeast(level, out.ageAssuranceMin[k])) out.ageAssuranceMin[k] = level;
    else rejected.push(`ageAssuranceMin.${k}`);
  }
  if (h.hearMinor !== undefined) {
    if (h.hearMinor === true) out.hearMinor = true;
    else rejected.push('hearMinor');
  }
  if (h.consentRenewalDays !== undefined) {
    const v = h.consentRenewalDays;
    const cur = out.consentRenewalDays;
    if (Number.isInteger(v) && v >= 30 && v <= 3650 && (cur === null || v <= cur)) out.consentRenewalDays = v;
    else rejected.push('consentRenewalDays');
  }
  // apostas e marketing (#1115): apostas só desligam, canal só passa a opt-in. A guarda legal não é do cliente:
  // mais curta descumpre a lei, mais longa recusa a exclusão do titular sem base legal
  if (h.bettingContent !== undefined) {
    if (h.bettingContent === false) out.bettingContent = false;
    else rejected.push('bettingContent');
  }
  for (const [k, v] of Object.entries(h.marketingConsent ?? {}) as [MarketingChannel, unknown][]) {
    if (v === 'opt-in' && (MARKETING_CHANNELS as readonly string[]).includes(k))
      out.marketingConsent[k] = 'opt-in';
    else rejected.push(`marketingConsent.${k}`);
  }
  return { policy: out, rejected };
}

export interface TenantCountry {
  country: string;
  primary: boolean;
  hardening?: PolicyHardening | null;
}

export interface ResolvedPolicy {
  /** Ficha usada (país, LATAM, DEFAULT ou o país principal do cliente). */
  key: PolicyKey;
  /** true = o país do torcedor não tem ficha nem cai na LATAM (usou a DEFAULT ou o país principal do cliente). */
  fallback: boolean;
  policy: CountryPolicy;
}

/**
 * Ficha que vale para o torcedor: a do país dele, a LATAM para país latino sem ficha, a `DEFAULT` para os demais ou,
 * sem ela, a do país principal do cliente; depois, o que o cliente endureceu para aquele país. Ficha gravada antes
 * do #1104 ganha as regras de idade mais protetivas. null = não há ficha que sirva (o módulo recusa a ação).
 */
export function resolvePolicy(
  fanCountry: string | null | undefined,
  policies: ReadonlyMap<PolicyKey, CountryPolicy>,
  tenantCountries: readonly TenantCountry[],
): ResolvedPolicy | null {
  // só ISO2: `LATAM` é chave de ficha, não país de torcedor
  const raw = fanCountry?.toUpperCase() ?? null;
  const country = raw && /^[A-Z]{2}$/.test(raw) ? raw : null;
  const primary = tenantCountries.find((c) => c.primary)?.country ?? null;
  const pick = (): { key: PolicyKey; fallback: boolean } | null => {
    if (country && policies.has(country)) return { key: country, fallback: false };
    if (country && LATAM_COUNTRIES.includes(country) && policies.has(LATAM_POLICY_KEY))
      return { key: LATAM_POLICY_KEY, fallback: false };
    if (country && policies.has(DEFAULT_POLICY_KEY)) return { key: DEFAULT_POLICY_KEY, fallback: true };
    if (primary && policies.has(primary)) return { key: primary, fallback: true };
    return null;
  };
  const chosen = pick();
  if (!chosen) return null;
  const chosenPolicy = completePolicy(policies.get(chosen.key)!);
  // a DEFAULT nunca protege menos que a ficha do país principal, que valia antes dela
  const base =
    chosen.key === DEFAULT_POLICY_KEY && primary && policies.has(primary)
      ? strictestOf(chosenPolicy, completePolicy(policies.get(primary)!))
      : chosenPolicy;
  // o endurecimento do cliente vale para o país do torcedor; se o cliente não marcou esse país (ou caiu no
  // fallback), vale o do país principal, para o torcedor de fora não escapar do que o cliente endureceu
  const tc =
    (!chosen.fallback && tenantCountries.find((c) => c.country === country)) ||
    tenantCountries.find((c) => c.primary);
  const policy = tc?.hardening ? hardenPolicy(base, tc.hardening).policy : base;
  return { ...chosen, policy };
}

/** Licença de operador de apostas do cliente para um país, aprovada pela Galaxie (#1115). */
export interface BettingLicense {
  /** Número ou referência da licença anexada pelo cliente. */
  reference: string;
  /** Quem da Galaxie aprovou e quando (ISO 8601); sem aprovação, a licença não vale. */
  approvedBy: string | null;
  approvedAt: string | null;
  /** Fim da validade (ISO 8601); null = sem prazo informado. */
  expiresAt?: string | null;
}

/**
 * Odds, anúncio ou link de casa de apostas podem aparecer para o torcedor? Só se a ficha que vale aceita (`true`,
 * já com o endurecimento do cliente) e o cliente tem licença aprovada pela Galaxie e válida para o país. Shop the
 * game, Gamificação e Cosmos chamam esta função antes de mostrar qualquer conteúdo de apostas.
 */
export function bettingContentAllowed(
  policy: Pick<CountryPolicy, 'bettingContent'>,
  license: BettingLicense | null | undefined,
  now: number = Date.now(),
): boolean {
  if (policy.bettingContent !== true || !license) return false;
  if (!license.reference?.trim() || !license.approvedBy || !license.approvedAt) return false;
  if (license.expiresAt) {
    const end = Date.parse(license.expiresAt);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return true;
}

/** O que o torcedor disse sobre marketing num canal: deu, recusou ou nunca respondeu. */
export type MarketingConsentState = 'granted' | 'denied' | 'none';

/**
 * Pode mandar marketing ao torcedor neste canal? Menor de 18 nunca recebe (#1103); `opt-in` exige consentimento
 * dado; `opt-out` envia até o torcedor recusar. Consentimento dado em outro país continua valendo se atende à ficha
 * do país novo, por isso a regra olha só o estado atual, não onde foi dado.
 */
export function marketingAllowed(
  policy: Pick<CountryPolicy, 'marketingConsent'>,
  channel: MarketingChannel,
  fan: { adult: boolean; consent: MarketingConsentState },
): boolean {
  if (!fan.adult || fan.consent === 'denied') return false;
  // canal desconhecido ou ficha sem o campo: trata como opt-in
  const mode = policy.marketingConsent?.[channel] ?? 'opt-in';
  return mode === 'opt-out' || fan.consent === 'granted';
}

/**
 * Até quando guardar o conteúdo removido que foi denunciado às autoridades (ms). Conta da denúncia, fora do relógio
 * de conteúdo removido; pedido de exclusão do titular é recusado até lá, com base legal.
 */
export function legalHoldUntil(policy: Pick<CountryPolicy, 'legalHoldDays'>, reportedAt: number): number {
  return reportedAt + policy.legalHoldDays * 24 * 3600_000;
}

const minNullable = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);
const strongest = (a: AgeAssuranceLevel, b: AgeAssuranceLevel) => (assuranceAtLeast(a, b) ? a : b);

/**
 * Campo a campo, o mais protetivo de duas fichas: idades maiores, retenção e prazos menores, o que uma proíbe fica
 * proibido. Entidade, moeda, formato, fuso, idiomas e leis vêm de `a`.
 */
export function strictestOf(a: CountryPolicy, b: CountryPolicy): CountryPolicy {
  const out = structuredClone(a);
  out.minAgeWrite = Math.max(a.minAgeWrite, b.minAgeWrite);
  out.minAgeParticipate = Math.max(a.minAgeParticipate, b.minAgeParticipate);
  for (const k of Object.keys(out.retention) as (keyof CountryPolicy['retention'])[])
    out.retention[k] = Math.min(a.retention[k], b.retention[k] ?? a.retention[k]);
  out.adsToMinors = a.adsToMinors && b.adsToMinors;
  for (const k of Object.keys(out.gamification) as (keyof CountryPolicy['gamification'])[])
    out.gamification[k] = a.gamification[k] && (b.gamification[k] ?? false);
  out.prizeCampaign = {
    // teto em moedas diferentes não se compara: com algum teto, o fallback fica sem prêmio até alguém converter
    maxValue:
      a.currency === b.currency
        ? minNullable(a.prizeCampaign.maxValue, b.prizeCampaign.maxValue)
        : a.prizeCampaign.maxValue === null && b.prizeCampaign.maxValue === null
          ? null
          : 0,
    excludedRegions: [...new Set([...a.prizeCampaign.excludedRegions, ...b.prizeCampaign.excludedRegions])],
    legalClassificationRequired:
      a.prizeCampaign.legalClassificationRequired || b.prizeCampaign.legalClassificationRequired,
  };
  out.punishmentNoticeRequired = a.punishmentNoticeRequired || b.punishmentNoticeRequired;
  out.parentalConsentUnder = Math.max(a.parentalConsentUnder, b.parentalConsentUnder);
  const links = [a.guardianLinkRequiredUnder, b.guardianLinkRequiredUnder].filter(
    (v): v is number => v !== null,
  );
  out.guardianLinkRequiredUnder = links.length
    ? Math.min(Math.max(...links), out.parentalConsentUnder)
    : null;
  for (const f of AGE_ASSURANCE_FEATURES)
    out.ageAssuranceMin[f] = strongest(a.ageAssuranceMin[f], b.ageAssuranceMin[f]);
  out.hearMinor = a.hearMinor || b.hearMinor;
  out.consentRenewalDays = minNullable(a.consentRenewalDays, b.consentRenewalDays);
  out.bettingContent = a.bettingContent && b.bettingContent;
  for (const c of MARKETING_CHANNELS)
    out.marketingConsent[c] =
      a.marketingConsent[c] === 'opt-out' && b.marketingConsent[c] === 'opt-out' ? 'opt-out' : 'opt-in';
  // guarda legal é obrigação de uma das duas fichas: vale a mais longa
  out.legalHoldDays = Math.max(a.legalHoldDays, b.legalHoldDays);
  return out;
}

/** Faixa etária do Perfil: a larga do token (#937) ou a fina (#1105). */
export type AgeBand = 'under13' | '13_17' | '13' | '14_15' | '16_17' | '18plus';
export type FanAction = 'participate' | 'write';

/** Idade mínima garantida pela faixa: o cliente informa a faixa, não a idade. */
const BAND_FLOOR: Record<AgeBand, number> = {
  under13: 0,
  '13_17': 13,
  '13': 13,
  '14_15': 14,
  '16_17': 16,
  '18plus': 18,
};

/** Idade mínima que a faixa garante (a larga `13_17` vale como 13, a mais restritiva). */
export const ageBandFloor = (band: AgeBand): number => BAND_FLOOR[band];

/**
 * A faixa cumpre a ficha para a ação? Checagem do servidor em toda rota de escrita dos cinco módulos. Uma ficha com
 * idade acima de 18 para escrever recusa todo mundo: a faixa `18plus` não prova 21.
 */
export function policyAllows(ageBand: AgeBand, action: FanAction, policy: CountryPolicy): boolean {
  const floor = BAND_FLOOR[ageBand];
  if (floor < policy.minAgeParticipate) return false;
  return action === 'participate' || floor >= policy.minAgeWrite;
}
