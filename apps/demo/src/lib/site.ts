/**
 * Dados públicos do site: endereço, empresa e contato. Aparecem na página de apresentação, nos termos,
 * na privacidade e nos metadados (Open Graph, JSON-LD, robots e sitemap), que filtros web corporativos e
 * buscadores leem para classificar o domínio.
 */

/** Endereço público da demo (canônico das páginas públicas, sitemap e JSON-LD). */
export const SITE_URL = 'https://sports.galaxie.works';

export const SITE_NAME = 'Galaxie Sports';

export const COMPANY = {
  name: 'Galaxie Works',
  url: 'https://galaxie.works',
} as const;

/**
 * E-mail de contato público (termos, privacidade e "fale com a gente").
 * PREENCHER: o repositório não tem um endereço de contato genérico; trocar pelo e-mail oficial antes de
 * pedir a recategorização aos filtros web.
 */
export const CONTACT_EMAIL = 'PREENCHER-email-de-contato@galaxie.works';

/** Logo usado no Open Graph e no JSON-LD (servido de /public, fora do proxy). */
export const LOGO_PATH = '/brand/galaxie_logo_dark.png';
