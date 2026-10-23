import type { Metadata } from 'next';

import { LegalPage } from '@/components/site/legal-page';
import { getI18n, getT } from '@/lib/i18n/server';
import { publicPageMetadata } from '@/lib/site-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  const doc = t.site.legal.terms;
  return publicPageMetadata({ locale, path: '/termos', title: doc.title, description: doc.description });
}

/** Termos de uso (público). */
export default async function TermsPage() {
  return <LegalPage doc={(await getT()).site.legal.terms} />;
}
