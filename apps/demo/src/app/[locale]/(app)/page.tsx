import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { CountryFlag } from '@/components/sport/country-flag';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n/server';
import { COUNTRIES, MULTISPORT_NAV, SPORTS, type NavItem } from '@/lib/navigation';

const GROUPS = ['CONMEBOL', 'CONCACAF', 'UEFA'] as const;

function EntryCard({
  item,
  label,
  description,
}: {
  item: NavItem & { slug?: string };
  label: string;
  description: string;
}) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className="group/entry focus-visible:outline-none">
      <Card
        size="sm"
        className="group-hover/entry:bg-accent group-focus-visible/entry:ring-ring h-full transition-colors"
      >
        <CardHeader>
          {item.slug ? (
            <AnimatedSportIcon slug={item.slug} className="text-primary mb-2 size-7">
              <Icon />
            </AnimatedSportIcon>
          ) : (
            <Icon className="text-primary mb-2 size-5" aria-hidden />
          )}
          <CardTitle>{label}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

/** Ponto de entrada da demo: navegar pelos metadados por esporte ou por país. */
export default async function ExplorePage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.nav.explore.title} kind="explorar" />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t.nav.explore.sports}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {SPORTS.map((s) => (
              <EntryCard
                key={s.slug}
                item={s}
                label={t.nav.sports[s.slug]}
                description={t.nav.explore.sportCard}
              />
            ))}
            <EntryCard
              item={MULTISPORT_NAV}
              label={t.nav.multisport}
              description={t.nav.explore.multisportCard}
            />
          </div>
        </section>

        {GROUPS.map((group) => (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t.nav.groups[group]} · {group}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {COUNTRIES.filter((c) => c.group === group).map((c) => (
                <Link key={c.code} href={c.href} className="group/entry focus-visible:outline-none">
                  <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                    <CardHeader>
                      <CountryFlag code={c.code} size="lg" className="mb-1" />
                      <CardTitle>{t.nav.countries[c.code]}</CardTitle>
                      <CardDescription>{t.nav.explore.countryCard}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
