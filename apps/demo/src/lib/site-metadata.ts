import type { Metadata } from 'next';

import type { Locale } from './i18n/config';
import { LOGO_PATH, SITE_NAME } from './site';

/** Locale do Open Graph (`pt_BR`), a partir do idioma da tela. */
const OG_LOCALE: Record<Locale, string> = { 'pt-BR': 'pt_BR', en: 'en_US', 'es-AR': 'es_AR' };

/**
 * Metadados de uma página pública: título, descrição, endereço canônico e Open Graph. As URLs saem
 * relativas e o `metadataBase` do layout as completa com o domínio público.
 */
export function publicPageMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: Locale;
  path: string;
  title: string | { absolute: string };
  description: string;
}): Metadata {
  const plainTitle = typeof title === 'string' ? `${title} · ${SITE_NAME}` : title.absolute;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: path,
      title: plainTitle,
      description,
      locale: OG_LOCALE[locale],
      images: [{ url: LOGO_PATH, alt: SITE_NAME }],
    },
    twitter: { card: 'summary', title: plainTitle, description },
  };
}
