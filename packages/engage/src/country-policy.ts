/**
 * Ficha por país (#954; arquitetura 01). Uma ficha por país, mantida pela Galaxie em Ajustes → Conformidade → Ficha
 * por país, que todos os módulos leem no servidor. País novo é ficha nova, sem código novo. O cliente marca os países onde
 * opera e só pode endurecer a ficha (`hardenPolicy`).
 *
 * Qual ficha vale (`resolvePolicy`): a do país do torcedor (no token); sem ficha própria, a de "demais da América
 * Latina" se o país for da região; senão, a do país principal do cliente.
 *
 * Os valores iniciais são de produto e ainda passam pelo advogado (as leis de referência estão em `laws`).
 */

/** Chave da ficha: ISO 3166-1 alfa-2 ou o grupo "demais da América Latina". */
export const LATAM_POLICY_KEY = 'LATAM';
export type PolicyKey = string;

export const isPolicyKey = (value: unknown): value is PolicyKey =>
  typeof value === 'string' && (/^[A-Z]{2}$/.test(value) || value === LATAM_POLICY_KEY);

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
}

const BASE = {
  minAgeWrite: 18,
  minAgeParticipate: 13,
  retention: { accessLogDays: 183, removedContentDays: 90, moderationDecisionsDays: 730 },
  adsToMinors: false,
  gamification: { materialExchange: false, marketplace: false, raffle: false },
  prizeCampaign: { maxValue: null, excludedRegions: [], legalClassificationRequired: true },
  punishmentNoticeRequired: false,
} satisfies Partial<CountryPolicy>;

const latam = (
  currency: string,
  timeZone: string,
  laws: string[],
  extra: Partial<CountryPolicy> = {},
): CountryPolicy => ({
  ...structuredClone(BASE),
  entity: 'ltda',
  currency,
  dateFormat: 'dd/MM/yyyy',
  timeZone,
  languages: ['es'],
  laws,
  ...extra,
});

/** Fichas iniciais (Brasil, Argentina, México, Colômbia, Chile, Peru, demais da América Latina, EUA e Canadá). */
export const INITIAL_COUNTRY_POLICIES: Readonly<Record<PolicyKey, CountryPolicy>> = {
  BR: latam(
    'BRL',
    'America/Sao_Paulo',
    ['ECA Digital (Lei 15.211/2025)', 'LGPD (Lei 13.709/2018)', 'Marco Civil da Internet (Lei 12.965/2014)'],
    { languages: ['pt-BR'] },
  ),
  AR: latam('ARS', 'America/Argentina/Buenos_Aires', ['Ley 25.326 de Protección de los Datos Personales']),
  MX: latam('MXN', 'America/Mexico_City', [
    'Ley Federal de Protección de Datos Personales en Posesión de los Particulares (2025)',
  ]),
  CO: latam('COP', 'America/Bogota', ['Ley 1581 de 2012 (Habeas Data)']),
  CL: latam('CLP', 'America/Santiago', ['Ley 19.628', 'Ley 21.719 (vigente desde dic. 2026)']),
  PE: latam('PEN', 'America/Lima', ['Ley 29733 de Protección de Datos Personales']),
  [LATAM_POLICY_KEY]: latam('USD', 'America/Panama', [
    'Leis locais de proteção de dados (a confirmar por país)',
  ]),
  US: {
    ...structuredClone(BASE),
    entity: 'llc',
    currency: 'USD',
    dateFormat: 'MM/dd/yyyy',
    timeZone: 'America/New_York',
    languages: ['en'],
    laws: ['COPPA', 'Leis estaduais de privacidade (CCPA/CPRA e outras)'],
  },
  CA: {
    ...structuredClone(BASE),
    entity: 'llc',
    currency: 'CAD',
    dateFormat: 'yyyy-MM-dd',
    timeZone: 'America/Toronto',
    languages: ['en'],
    laws: ['PIPEDA', 'Lei 25 do Quebec'],
  },
};

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
}

/**
 * Aplica o que o cliente endureceu. Campo que afrouxa (idade menor, retenção maior, liberar o que a ficha
 * proíbe, teto de prêmio maior) é ignorado e devolvido em `rejected`.
 */
export function hardenPolicy(
  policy: CountryPolicy,
  h: PolicyHardening,
): { policy: CountryPolicy; rejected: string[] } {
  const out = structuredClone(policy);
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
  return { policy: out, rejected };
}

export interface TenantCountry {
  country: string;
  primary: boolean;
  hardening?: PolicyHardening | null;
}

export interface ResolvedPolicy {
  /** Ficha usada (país, LATAM ou o país principal do cliente). */
  key: PolicyKey;
  /** true = caiu no país principal do cliente (o país do torcedor não tem ficha). */
  fallback: boolean;
  policy: CountryPolicy;
}

/**
 * Ficha que vale para o torcedor: a do país dele, a LATAM para país latino sem ficha, ou a do país principal do
 * cliente; depois, o que o cliente endureceu para aquele país. null = nem o país principal tem ficha (o
 * módulo recusa a ação).
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
    if (primary && policies.has(primary)) return { key: primary, fallback: true };
    return null;
  };
  const chosen = pick();
  if (!chosen) return null;
  const base = policies.get(chosen.key)!;
  // o endurecimento do cliente vale para o país do torcedor; se o cliente não marcou esse país (ou caiu no
  // fallback), vale o do país principal, para o torcedor de fora não escapar do que o cliente endureceu
  const tc =
    (!chosen.fallback && tenantCountries.find((c) => c.country === country)) ||
    tenantCountries.find((c) => c.primary);
  const policy = tc?.hardening ? hardenPolicy(base, tc.hardening).policy : base;
  return { ...chosen, policy };
}

/** Faixa etária do Perfil (no token, #937). */
export type AgeBand = 'under13' | '13_17' | '18plus';
export type FanAction = 'participate' | 'write';

/** Idade mínima garantida pela faixa: o cliente informa a faixa, não a idade. */
const BAND_FLOOR: Record<AgeBand, number> = { under13: 0, '13_17': 13, '18plus': 18 };

/**
 * A faixa cumpre a ficha para a ação? Checagem do servidor em toda rota de escrita dos cinco módulos. Uma ficha com
 * idade acima de 18 para escrever recusa todo mundo: a faixa `18plus` não prova 21.
 */
export function policyAllows(ageBand: AgeBand, action: FanAction, policy: CountryPolicy): boolean {
  const floor = BAND_FLOOR[ageBand];
  if (floor < policy.minAgeParticipate) return false;
  return action === 'participate' || floor >= policy.minAgeWrite;
}
