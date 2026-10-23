import type { Metadata } from 'next';

import { LegalPage } from '@/components/site/legal-page';
import { getI18n, getT } from '@/lib/i18n/server';
import { publicPageMetadata } from '@/lib/site-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  const doc = t.site.legal.privacy;
  return publicPageMetadata({ locale, path: '/privacidade', title: doc.title, description: doc.description });
}

/** Política de privacidade (pública). */
export default async function PrivacyPage() {
  return <LegalPage doc={(await getT()).site.legal.privacy} />;
}
