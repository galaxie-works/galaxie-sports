/**
 * Perfil de torcedor da demo (#1020): o site Galaxie é cliente de si mesmo. Quem entra na demo informa um
 * apelido, a faixa etária e o país (nunca a data de nascimento) e o tenant da demo emite o token `gft_` para
 * essa pessoa (`POST /v1/fans/tokens`, com a chave da demo, só no servidor). O apelido é o que aparece nos
 * recursos do torcedor; o nome e o e-mail do login nunca vão para a API.
 */

export const FAN_AGE_BANDS = ['under13', '13_17', '18plus'] as const;
export type FanAgeBand = (typeof FAN_AGE_BANDS)[number];

/** Países do perfil de torcedor (ISO 3166-1 alfa-2); o nome sai do `Intl.DisplayNames` no idioma da tela. */
export const FAN_COUNTRIES = [
  'BR',
  'AR',
  'UY',
  'CL',
  'CO',
  'PY',
  'PE',
  'EC',
  'BO',
  'VE',
  'MX',
  'US',
  'PT',
  'ES',
  'IT',
  'DE',
  'FR',
  'GB',
] as const;
export type FanCountry = (typeof FAN_COUNTRIES)[number];

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 32;

export interface FanProfile {
  nickname: string;
  ageBand: FanAgeBand;
  country: FanCountry;
}

export type FanProfileField = keyof FanProfile;

/** Confere o que veio do formulário (vem do navegador: nada de confiar no formato). */
export function parseFanProfile(
  input: unknown,
): { ok: true; value: FanProfile } | { ok: false; field: FanProfileField } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const nickname = typeof o.nickname === 'string' ? o.nickname.trim().replace(/\s+/g, ' ') : '';
  if (
    [...nickname].length < NICKNAME_MIN ||
    [...nickname].length > NICKNAME_MAX ||
    [...nickname].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    /@/.test(nickname)
  )
    return { ok: false, field: 'nickname' };
  if (!(FAN_AGE_BANDS as readonly unknown[]).includes(o.ageBand)) return { ok: false, field: 'ageBand' };
  if (!(FAN_COUNTRIES as readonly unknown[]).includes(o.country)) return { ok: false, field: 'country' };
  return {
    ok: true,
    value: { nickname, ageBand: o.ageBand as FanAgeBand, country: o.country as FanCountry },
  };
}

/** O perfil gravado no usuário da demo, ou null se falta algo (aí não há token). */
export function storedFanProfile(user: {
  fanNickname?: string | null;
  fanAgeBand?: string | null;
  fanCountry?: string | null;
}): FanProfile | null {
  const r = parseFanProfile({
    nickname: user.fanNickname,
    ageBand: user.fanAgeBand,
    country: user.fanCountry,
  });
  return r.ok ? r.value : null;
}

/** Idioma do token: o da demo, no formato curto que a API aceita. */
const API_LOCALES: Record<string, string> = { 'pt-BR': 'pt-BR', en: 'en', 'es-AR': 'es-AR' };

export function apiFanLocale(locale: string | null | undefined): string {
  return API_LOCALES[locale ?? ''] ?? 'pt-BR';
}

/**
 * Corpo de `POST /v1/fans/tokens` para a pessoa logada. Conta e Perfil usam o id opaco do usuário da demo
 * (um Perfil por Conta); nada do login (nome, e-mail) vai junto.
 */
export function demoFanTokenBody(userId: string, profile: FanProfile, locale: string | null | undefined) {
  const id = `demo:${userId}`;
  return {
    externalAccountId: id,
    externalProfileId: id,
    nickname: profile.nickname,
    ageBand: profile.ageBand,
    country: profile.country,
    locale: apiFanLocale(locale),
    // a demo não sabe se o titular é adulto: o Prêmio fica pendente, como manda a regra
    holderAdult: 'unknown' as const,
    surface: 'web' as const,
  };
}
