/**
 * Dados públicos do site: endereço, empresa e contato. Aparecem na página de apresentação, nos termos,
 * na privacidade e nos metadados (Open Graph, JSON-LD, robots e sitemap), que filtros web corporativos e
 * buscadores leem para classificar o domínio.
 */

/**
 * Endereço público da plataforma (canônico das páginas públicas, sitemap, JSON-LD, embed e registry dos widgets).
 * Vem de `NEXT_PUBLIC_SITE_URL` no build (o Next embute o valor); o padrão é o domínio de produção. É o único lugar
 * com o host do produto no app: a troca de domínio (#635) muda só este padrão, o da API em `galaxie/request.ts` e o
 * `.env` da VPS (`DEMO_DOMAIN`, `API_DOMAIN`).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://sports.galaxie.works').replace(/\/+$/, '');

/** Só o host de `SITE_URL` (sem protocolo), para os textos que citam o endereço (termos e privacidade). */
export const SITE_HOST = new URL(SITE_URL).host;

export const SITE_NAME = 'Galaxie Sports';

export const COMPANY = {
  name: 'Galaxie Works',
  url: 'https://galaxie.works',
} as const;

/** E-mail de contato público (apresentação, termos, privacidade e JSON-LD). */
export const CONTACT_EMAIL = 'hello@galaxie.works';

/** Página pública de status (Better Stack, fora da VPS: continua no ar quando ela cai). */
export const STATUS_URL = 'https://status.galaxie.works';

/** Logo usado no JSON-LD (servido de /public, fora do proxy). */
export const LOGO_PATH = '/brand/galaxie_logo_dark.png';

/** Imagem de preview ao compartilhar o link (Open Graph, 1200×630): logo, céu estrelado e o produto. */
export const SHARE_IMAGE = { url: '/brand/og-galaxie-sports.png', width: 1200, height: 630 } as const;
