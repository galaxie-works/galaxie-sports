import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { LOCALES } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { getLocale, getT } from '@/lib/i18n/server';
import { APPLE_TOUCH_ICON, SITE_NAME, SITE_URL } from '@/lib/site';

import { Providers } from '../providers';
import '../globals.css';

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/** Um shell estático por idioma: o proxy reescreve cada URL para `/<idioma>/...` (cookie ou navegador). */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    // Endereço público: completa as URLs relativas do Open Graph e do canônico das páginas públicas.
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: t.shell.meta.description,
    // Símbolo da Galaxie: o favicon.ico (app/) o Next já anuncia; aqui, o ícone da tela inicial do iOS.
    icons: { apple: APPLE_TOUCH_ICON },
  };
}

export default async function RootLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Providers locale={locale} messages={clientDictionary(locale)}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
