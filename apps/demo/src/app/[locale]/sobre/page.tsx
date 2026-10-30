import { KeyRound, Mail, UserPlus } from 'lucide-react';
import type { Metadata, Viewport } from 'next';

import { AppPages } from '@/components/site/landing/app-pages';
import { Audience } from '@/components/site/landing/audience';
import { Bento } from '@/components/site/landing/bento';
import { FanJourney } from '@/components/site/landing/fan-journey';
import { Hero, Numbers } from '@/components/site/landing/hero';
import { Layer } from '@/components/site/landing/layer';
import { MarketsGrid } from '@/components/site/landing/markets';
import { SectionHeading } from '@/components/site/landing/parts';
import { SportsGrid } from '@/components/site/landing/sports';
import { PublicShell } from '@/components/site/public-shell';
import { buttonVariants } from '@/components/ui/button';
import { getI18n } from '@/lib/i18n/server';
import { LANDING_PAGE } from '@/lib/public-routes';
import { COMPANY, CONTACT_EMAIL, LOGO_PATH, SITE_NAME, SITE_URL } from '@/lib/site';
import { publicPageMetadata } from '@/lib/site-metadata';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return publicPageMetadata({
    locale,
    path: LANDING_PAGE,
    title: { absolute: t.site.meta.title },
    description: t.site.meta.description,
  });
}

/** Barra do navegador no tom do fundo da página. */
export const viewport: Viewport = { themeColor: '#0a0a0f', colorScheme: 'dark' };

const STEP_ICONS = { invite: UserPlus, login: Mail, api: KeyRound } as const;

/**
 * Apresentação pública da Galaxie Sports (também é o que a raiz mostra para quem não tem sessão). Abre pela
 * camada que a Galaxie põe sobre o dado (onde assistir, clássicos e torcidas, contexto com IA) e por quem
 * compra (mídia, entretenimento e portais), antes dos exemplos; não fala de preço.
 * Estática por idioma: texto real e indexável para buscadores e filtros web, exemplos reais da base em
 * `lib/showcase.ts` e JSON-LD da empresa e do site.
 */
export default async function AboutPage() {
  const { locale, t } = await getI18n();
  const l = t.landing;
  const s = t.site;

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
    <PublicShell onLanding>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <Hero t={l} locale={locale} />
      <Numbers t={l.stats} locale={locale} />

      <section aria-labelledby="jornada" className="pt-24">
        <SectionHeading
          id="jornada"
          eyebrow={l.journey.eyebrow}
          title={l.journey.title}
          lead={l.journey.lead}
        />
        <div className="mt-10">
          <FanJourney t={l.journey} context={l} locale={locale} />
        </div>
      </section>

      <section aria-labelledby="camada" className="pt-24">
        <SectionHeading id="camada" eyebrow={l.layer.eyebrow} title={l.layer.title} lead={l.layer.lead} />
        <div className="mt-10">
          <Layer t={l.layer} />
        </div>
      </section>

      <section aria-labelledby="para-quem" className="pt-24">
        <SectionHeading
          id="para-quem"
          eyebrow={l.audience.eyebrow}
          title={l.audience.title}
          lead={l.audience.lead}
        />
        <div className="mt-10">
          <Audience t={l.audience} />
        </div>
      </section>

      <section aria-labelledby="recursos" className="pt-24">
        <SectionHeading id="recursos" eyebrow={l.bento.eyebrow} title={l.bento.title} lead={l.bento.lead} />
        <div className="mt-10">
          <Bento t={l.bento} app={l.app} positions={t.pages.person.positions} locale={locale} />
        </div>
      </section>

      <section aria-labelledby="paginas" className="pt-24">
        <SectionHeading id="paginas" eyebrow={l.app.eyebrow} title={l.app.sectionTitle} lead={l.app.lead} />
        <div className="mt-10">
          <AppPages t={l.app} />
        </div>
      </section>

      <section aria-labelledby="esportes" className="pt-24">
        <SectionHeading
          id="esportes"
          eyebrow={l.sports.eyebrow}
          title={l.sports.title}
          lead={l.sports.lead}
        />
        <div className="mt-10">
          <SportsGrid t={l.sports} />
        </div>
      </section>

      <section aria-labelledby="mercados" className="pt-24">
        <SectionHeading
          id="mercados"
          eyebrow={l.markets.eyebrow}
          title={l.markets.title}
          lead={l.markets.lead}
        />
        <div className="mt-10">
          <MarketsGrid t={l.markets} locale={locale} />
        </div>
      </section>

      <section aria-labelledby="acesso" className="grid gap-10 pt-24 lg:grid-cols-[1fr_1.2fr]">
        <SectionHeading
          id="acesso"
          eyebrow={l.access.eyebrow}
          title={l.access.heading}
          lead={l.access.lead}
        />
        <div>
          <h3 className="text-lg font-semibold">{l.access.title}</h3>
          <ol className="mt-4 grid gap-3">
            {(Object.keys(STEP_ICONS) as (keyof typeof STEP_ICONS)[]).map((key, i) => {
              const Icon = STEP_ICONS[key];
              const step = l.access.steps[key];
              return (
                <li key={key} className="bg-card/60 flex gap-4 rounded-2xl border p-5 backdrop-blur-sm">
                  <span className="bg-primary/15 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="text-muted-foreground text-xs tabular-nums">{`0${i + 1}`}</span>
                    <span className="block font-medium">{step.title}</span>
                    <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
                      {step.body}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="pt-24" aria-labelledby="cta">
        <div className="explore-card relative overflow-hidden rounded-3xl border px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2 id="cta" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {l.cta.title}
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-lg text-pretty">{l.cta.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5 text-base')}
            >
              {l.cta.contact}
            </a>
            <a
              href="/login"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 px-5 text-base')}
            >
              {l.cta.signIn}
            </a>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
