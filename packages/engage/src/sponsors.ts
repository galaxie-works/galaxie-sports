/**
 * Patrocinadores do cliente (#1021, B10): um cadastro só, usado pela campanha de bolão (#945), pela sala do chat
 * (#985) e pelas recompensas (#931). Aqui só as regras, sem banco nem HTTP:
 *
 * - casa de aposta não existe como categoria, e nome ou link que o filtro reconhece como aposta (lista da
 *   Galaxie, Ajustes → Conformidade → Moderação) é recusado;
 * - peça de patrocinador não aparece para `under13`, nem para `13_17` quando a ficha do país proíbe publicidade a
 *   menores (`adsToMinors`, B5);
 * - fora da vigência ou fora dos países do patrocinador, não aparece.
 */
import type { CountryPolicy } from './country-policy.js';
import { normalizeDomain, screen, type CompiledLists } from './moderation.js';

/** Categorias do cadastro. Aposta, cassino e loteria não existem aqui, de propósito. */
export const SPONSOR_CATEGORIES = [
  'apparel',
  'automotive',
  'beverage',
  'education',
  'energy',
  'finance',
  'food',
  'health',
  'media',
  'retail',
  'technology',
  'telecom',
  'travel',
  'other',
] as const;
export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];

export const isSponsorCategory = (v: unknown): v is SponsorCategory =>
  typeof v === 'string' && (SPONSOR_CATEGORIES as readonly string[]).includes(v);

/** Onde a peça aparece; é a chave das impressões agregadas. */
export const SPONSOR_SURFACES = ['chat_room', 'prediction_campaign', 'reward'] as const;
export type SponsorSurface = (typeof SPONSOR_SURFACES)[number];

export interface SponsorInput {
  name: string;
  category: string;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  /** ISO 3166-1 alfa-2; vazio = todos os países do cliente. */
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
}

export interface Sponsor {
  name: string;
  category: SponsorCategory;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
}

export type SponsorIssueCode = 'name' | 'category' | 'betting' | 'url' | 'countries' | 'dates';

export interface SponsorIssue {
  field: keyof SponsorInput;
  code: SponsorIssueCode;
}

const COUNTRY = /^[A-Z]{2}$/;
const MAX_COUNTRIES = 60;

function httpsUrl(v: string | null): string | null | undefined {
  if (v === null || v.trim() === '') return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Aposta no nome ou no link, pelas listas da Galaxie (termos de aposta e domínios de aposta). */
export function looksLikeBetting(text: string, lists: CompiledLists): boolean {
  if (!text.trim()) return false;
  return screen(text, { kind: 'wall_post' }, lists).reasons.includes('betting');
}

function hostOf(url: string): string {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

/**
 * Confere e normaliza o cadastro. Devolve o patrocinador pronto para gravar ou a lista de problemas. A tela
 * mostra os problemas; o servidor chama de novo antes de gravar.
 */
export function validateSponsor(
  input: SponsorInput,
  lists: CompiledLists,
): { ok: true; sponsor: Sponsor } | { ok: false; issues: SponsorIssue[] } {
  const issues: SponsorIssue[] = [];
  const name = String(input.name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) issues.push({ field: 'name', code: 'name' });
  else if (looksLikeBetting(name, lists)) issues.push({ field: 'name', code: 'betting' });

  // categoria fora da lista é recusada, inclusive `betting` mandado à mão
  if (!isSponsorCategory(input.category))
    issues.push({
      field: 'category',
      code: /bet|aposta|apuesta|casino|cassino|loter/i.test(String(input.category)) ? 'betting' : 'category',
    });

  const urls = {} as Record<'linkUrl' | 'logoLightUrl' | 'logoDarkUrl', string | null>;
  for (const field of ['linkUrl', 'logoLightUrl', 'logoDarkUrl'] as const) {
    const v = httpsUrl(input[field]);
    if (v === undefined) issues.push({ field, code: 'url' });
    else urls[field] = v;
  }
  if (urls.linkUrl) {
    const host = hostOf(urls.linkUrl);
    const betHost = lists.betDomains.some((d) => host === d || host.endsWith(`.${d}`));
    if (betHost || looksLikeBetting(host, lists)) issues.push({ field: 'linkUrl', code: 'betting' });
  }

  const countries = [...new Set((input.countries ?? []).map((c) => String(c).trim().toUpperCase()))];
  if (countries.length > MAX_COUNTRIES || countries.some((c) => !COUNTRY.test(c)))
    issues.push({ field: 'countries', code: 'countries' });

  const date = (v: string | null) => {
    if (v === null || v === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const startsAt = date(input.startsAt);
  const endsAt = date(input.endsAt);
  if (startsAt === undefined) issues.push({ field: 'startsAt', code: 'dates' });
  if (endsAt === undefined) issues.push({ field: 'endsAt', code: 'dates' });
  if (startsAt && endsAt && endsAt <= startsAt) issues.push({ field: 'endsAt', code: 'dates' });

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    sponsor: {
      name,
      category: input.category as SponsorCategory,
      linkUrl: urls.linkUrl ?? null,
      logoLightUrl: urls.logoLightUrl ?? null,
      logoDarkUrl: urls.logoDarkUrl ?? null,
      countries: countries.sort(),
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    },
  };
}

/**
 * A peça do patrocinador pode aparecer para este torcedor agora? `policy` é a ficha do país do torcedor
 * (B5); sem ficha, menores ficam de fora.
 */
export function sponsorVisible(
  sponsor: Pick<Sponsor, 'countries' | 'startsAt' | 'endsAt'> & { archived?: boolean },
  viewer: { country: string; ageBand: 'under13' | '13_17' | '18plus'; now: Date },
  policy: Pick<CountryPolicy, 'adsToMinors'> | null,
): boolean {
  if (sponsor.archived) return false;
  if (viewer.ageBand === 'under13') return false;
  if (viewer.ageBand === '13_17' && !policy?.adsToMinors) return false;
  const country = viewer.country.toUpperCase();
  if (sponsor.countries.length && !sponsor.countries.includes(country)) return false;
  const t = viewer.now.getTime();
  if (sponsor.startsAt && t < new Date(sponsor.startsAt).getTime()) return false;
  if (sponsor.endsAt && t >= new Date(sponsor.endsAt).getTime()) return false;
  return true;
}
