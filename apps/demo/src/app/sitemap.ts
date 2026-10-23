import type { MetadataRoute } from 'next';

import { PUBLIC_PAGES } from '@/lib/public-routes';
import { SITE_URL } from '@/lib/site';

/** Só as páginas públicas (a área logada fica fora do índice). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path, i) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly',
    priority: i === 0 ? 1 : 0.5,
  }));
}
