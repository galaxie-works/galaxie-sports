import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { CountryFlag } from '@/components/sport/country-flag';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COUNTRIES, MULTISPORT_NAV, SPORTS, type NavItem } from '@/lib/navigation';

const GROUP_LABEL = {
  CONMEBOL: 'América do Sul',
  CONCACAF: 'América do Norte',
  UEFA: 'Europa',
} as const;

function EntryCard({ item, description }: { item: NavItem; description: string }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className="group/entry focus-visible:outline-none">
      <Card
        size="sm"
        className="group-hover/entry:bg-accent group-focus-visible/entry:ring-ring h-full transition-colors"
      >
        <CardHeader>
          <Icon className="text-primary mb-2 size-5" aria-hidden />
          <CardTitle>{item.label}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

/** Ponto de entrada da demo: navegar pelos metadados por esporte ou por país. */
export default function ExplorePage() {
  return (
    <>
      <PageHeader title="Explorar" />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Esportes</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {SPORTS.map((s) => (
              <EntryCard key={s.slug} item={s} description="Competições, times e partidas" />
            ))}
            <EntryCard item={MULTISPORT_NAV} description="Medalhas, agenda e atletas" />
          </div>
        </section>

        {(Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((group) => (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {GROUP_LABEL[group]} · {group}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {COUNTRIES.filter((c) => c.group === group).map((c) => (
                <Link key={c.code} href={c.href} className="group/entry focus-visible:outline-none">
                  <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                    <CardHeader>
                      <CountryFlag code={c.code} size="lg" className="mb-1" />
                      <CardTitle>{c.label}</CardTitle>
                      <CardDescription>Ligas, copas e seleção</CardDescription>
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
