'use client';

import { Download } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { PeriodPicker } from '@/components/cosmos/period-picker';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ShopReportRow } from '@/lib/client/shop-report';
import { useI18n } from '@/lib/i18n/client';

const ALL = '__all__';

/**
 * Filtros do relatório do Shopping (#930): período, competição, time e loja (listas em ordem alfabética, vindas dos
 * cliques do período), na URL; e o CSV com os mesmos filtros.
 */
export function ShopReportFilters({
  period,
  options,
}: {
  period: { from: string; to: string };
  options: { competitions: ShopReportRow[]; teams: ShopReportRow[]; stores: ShopReportRow[] };
}) {
  const { t } = useI18n();
  const T = t.shopping.report;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const go = (edit: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(search.toString());
    edit(q);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const csv = new URLSearchParams();
  csv.set('from', search.get('from') ?? period.from);
  csv.set('to', search.get('to') ?? period.to);
  for (const k of ['competition', 'team', 'store']) {
    const v = search.get(k);
    if (v) csv.set(k, v);
  }

  const filter = (key: 'competition' | 'team' | 'store', all: string, rows: ShopReportRow[]) => {
    const items = [{ value: ALL, label: all }, ...rows.map((r) => ({ value: r.id, label: r.label }))];
    return (
      <Select
        items={items}
        value={search.get(key) ?? ALL}
        onValueChange={(v) =>
          go((q) => {
            if (!v || v === ALL) q.delete(key);
            else q.set(key, String(v));
          })
        }
      >
        <SelectTrigger className="w-full sm:w-52" aria-label={T[key]}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <PeriodPicker
        period={period}
        onApply={(p) =>
          go((q) => {
            q.set('from', p.from);
            q.set('to', p.to);
          })
        }
      />
      {filter('competition', T.allCompetitions, options.competitions)}
      {filter('team', T.allTeams, options.teams)}
      {filter('store', T.allStores, options.stores)}
      <Button
        variant="outline"
        size="sm"
        className="lg:ml-auto"
        nativeButton={false}
        render={<a href={`/api/cliente/shopping/relatorio?${csv.toString()}`} download />}
      >
        <Download aria-hidden />
        {T.csv}
      </Button>
    </div>
  );
}
