import { CalendarDays, ChartColumn, Quote, Radio, Trophy, Tv, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';

import { PublicShell } from '@/components/site/public-shell';
import { buttonVariants } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { rich } from '@/lib/i18n/text';
import { LANDING_PAGE } from '@/lib/public-routes';
import { COMPANY, CONTACT_EMAIL, LOGO_PATH, SITE_NAME, SITE_URL } from '@/lib/site';
import { publicPageMetadata } from '@/lib/site-metadata';

type Feature = keyof Dictionary['site']['features']['items'];

const FEATURE_ICONS: Record<Feature, LucideIcon> = {
  schedule: CalendarDays,
  results: Trophy,
  live: Radio,
  stats: ChartColumn,
  whereToWatch: Tv,
  context: Quote,
};

/** Mercados da API: o Brasil e os sete países de língua espanhola com voz própria. */
const MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'];

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return publicPageMetadata({
    locale,
    path: LANDING_PAGE,
    title: { absolute: t.site.meta.title },
    description: t.site.meta.description,
  });
}

const mail = (chunk: string) => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-4">
    {chunk}
  </a>
);

/**
 * Apresentação pública da Galaxie Sports (também é o que a raiz mostra para quem não tem sessão).
 * Estática por idioma: texto real e indexável para buscadores e filtros web, com JSON-LD da empresa e
 * do site.
 */
export default async function AboutPage() {
  const { locale, t } = await getI18n();
  const s = t.site;
  const regions = new Intl.DisplayNames([locale], { type: 'region' });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${COMPANY.url}/#organization`,
        name: COMPANY.name,
        url: COMPANY.url,
        logo: `${SITE_URL}${LOGO_PATH}`,
        email: CONTACT_EMAIL,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: s.meta.description,
        inLanguage: locale,
        publisher: { '@id': `${COMPANY.url}/#organization` },
      },
    ],
  };

  return (
    <PublicShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <section className="py-14 sm:py-24">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">{s.hero.eyebrow}</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {s.hero.title}
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">{s.hero.lead}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <a href="/login" className={buttonVariants({ size: 'lg' })}>
            {s.hero.cta}
          </a>
          <span className="text-muted-foreground text-sm">{s.hero.invite}</span>
        </div>
      </section>

      <section className="py-10" aria-labelledby="recursos">
        <h2 id="recursos" className="text-2xl font-semibold tracking-tight">
          {s.features.title}
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(FEATURE_ICONS) as Feature[]).map((key) => {
            const Icon = FEATURE_ICONS[key];
            const item = s.features.items[key];
            return (
              <article key={key} className="bg-card/60 rounded-xl border p-5 backdrop-blur-sm">
                <Icon className="text-muted-foreground size-5" aria-hidden />
                <h3 className="mt-3 font-medium">{item.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-10 py-10 lg:grid-cols-2">
        <section aria-labelledby="esportes">
          <h2 id="esportes" className="text-2xl font-semibold tracking-tight">
            {s.sports.title}
          </h2>
          <p className="text-muted-foreground mt-2">{s.sports.lead}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {Object.entries(s.sports.items).map(([key, name]) => (
              <li key={key} className="bg-card/60 rounded-full border px-3 py-1 text-sm">
                {name}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="mercados">
          <h2 id="mercados" className="text-2xl font-semibold tracking-tight">
            {s.markets.title}
          </h2>
          <p className="text-muted-foreground mt-2">{s.markets.lead}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {MARKETS.map((code) => (
              <li key={code} className="bg-card/60 rounded-full border px-3 py-1 text-sm">
                {regions.of(code)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-10 py-10 lg:grid-cols-2">
        <section aria-labelledby="publico">
          <h2 id="publico" className="text-2xl font-semibold tracking-tight">
            {s.audience.title}
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">{s.audience.body}</p>
        </section>
        <section aria-labelledby="acesso">
          <h2 id="acesso" className="text-2xl font-semibold tracking-tight">
            {s.access.title}
          </h2>
          <ol className="mt-4 space-y-3">
            {Object.values(s.access.steps).map((step, i) => (
              <li key={i} className="text-muted-foreground flex gap-3 leading-relaxed">
                <span className="text-foreground bg-card grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              {s.nav.signIn}
            </a>
            <span className="text-muted-foreground text-sm">
              {rich(s.access.noAccess, { email: mail }, { email: CONTACT_EMAIL })}
            </span>
          </div>
        </section>
      </div>

      <section className="py-10" aria-labelledby="empresa">
        <div className="bg-card/60 rounded-xl border p-6 backdrop-blur-sm">
          <h2 id="empresa" className="text-2xl font-semibold tracking-tight">
            {s.company.title}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-3xl leading-relaxed">{s.company.body}</p>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{s.company.site}</dt>
              <dd className="mt-1">
                <a href={COMPANY.url} className="underline underline-offset-4">
                  {COMPANY.url.replace('https://', '')}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{s.company.contact}</dt>
              <dd className="mt-1 break-all">{mail(CONTACT_EMAIL)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </PublicShell>
  );
}
