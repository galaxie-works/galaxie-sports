/**
 * Regras puras do assistente de criação da organização (doc 02 §Cadastro): mercados que o cadastro aceita, moeda e
 * entidade por país (PL8: Brasil fatura pela Ltda em reais; o resto, pela LLC em dólares), identificador da marca a
 * partir do nome e os limites dos campos. Sem banco: o assistente (componente de cliente) importa daqui.
 */
import type { BillingEntity, OrganizationCurrency } from '@galaxie/db/schema';

/** Países que o cadastro aceita como mercado principal: os do Onde Assistir (ISO2). */
export const SIGNUP_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'] as const;
export type SignupMarket = (typeof SIGNUP_MARKETS)[number];
export const isSignupMarket = (value: unknown): value is SignupMarket =>
  typeof value === 'string' && (SIGNUP_MARKETS as readonly string[]).includes(value);

/** Moeda e entidade que faturam pelo país principal (PL8). */
export function billingFor(country: SignupMarket): {
  currency: OrganizationCurrency;
  billingEntity: BillingEntity;
} {
  return country === 'BR'
    ? { currency: 'brl', billingEntity: 'ltda' }
    : { currency: 'usd', billingEntity: 'llc' };
}

/** O mesmo formato que a API exige do slug do tenant (`apps/api/src/admin/routes.ts`). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const NAME_MAX = 120;
export const PERSON_NAME_MAX = 200;

export const isValidSlug = (value: unknown): value is string =>
  typeof value === 'string' && SLUG_RE.test(value);

/** Identificador sugerido a partir do nome: sem acentos, minúsculas, hífens (`Clube do Remo` → `clube-do-remo`). */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

/** Nome aparado, com espaços repetidos juntados; null se vazio ou longo demais. */
export function normalizeName(value: unknown, max = NAME_MAX): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= max ? name : null;
}

/** Cor principal da marca (`#rrggbb`); null se não serve. */
export function normalizeBrandColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : null;
}

/** Origem padrão da chave publicável da marca: o host da marca na plataforma (`https://<slug>.<host>`). */
export const defaultBrandOrigin = (slug: string, platformHost: string) => `https://${slug}.${platformHost}`;
