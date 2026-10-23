import type { MetadataRoute } from 'next';

import { PUBLIC_PAGES } from '@/lib/public-routes';
import { SITE_URL } from '@/lib/site';

/**
 * Robôs só nas páginas públicas: a raiz (que, sem sessão, mostra a apresentação), as páginas do
 * sitemap, o login e os arquivos de que elas precisam para renderizar. O resto exige login.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', ...PUBLIC_PAGES, '/login', '/brand/', '/_next/static/'],
      disallow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
