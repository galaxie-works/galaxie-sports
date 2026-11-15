import type { MetadataRoute } from 'next';

import { LEGACY_ROUTES } from '@/lib/legacy-routes';
import { PUBLIC_PAGES } from '@/lib/public-routes';
import { SITE_URL } from '@/lib/site';

/**
 * Endereço em português das páginas públicas (`/sobre` → `/about`, #630): continua liberado enquanto valer o 301, para
 * o buscador ler o redirecionamento e passar o histórico para o endereço novo.
 */
const LEGACY_PUBLIC_PAGES = LEGACY_ROUTES.filter(([, to]) =>
  (PUBLIC_PAGES as readonly string[]).includes(to),
).map(([from]) => `${from}$`);

/**
 * Robôs só nas páginas públicas: a raiz (que, sem sessão, mostra a apresentação), as páginas do
 * sitemap, o login e os arquivos de que elas precisam para renderizar. O resto exige login.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [
        '/$',
        ...PUBLIC_PAGES,
        ...LEGACY_PUBLIC_PAGES,
        '/login',
        '/brand/',
        '/flags/',
        '/crests/',
        '/showcase/',
        '/_next/static/',
      ],
      disallow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
