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

/** E-mail de contato público (apresentação, termos, privacidade e JSON-LD). */
export const CONTACT_EMAIL = 'hello@galaxie.works';

/** Logo usado no JSON-LD (servido de /public, fora do proxy). */
export const LOGO_PATH = '/brand/galaxie_logo_dark.png';

/** Imagem de preview ao compartilhar o link (Open Graph, 1200×630): logo, céu estrelado e o produto. */
export const SHARE_IMAGE = { url: '/brand/og-galaxie-sports.png', width: 1200, height: 630 } as const;
