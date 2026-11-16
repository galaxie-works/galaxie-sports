'use client';

import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { ExplainEmpty, SettingsSection } from '@/components/settings';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { OrganizationRow } from '@/lib/client/organizations';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const REVIEW_VARIANT = {
  none: 'secondary',
  pending: 'warning-light',
  approved: 'success-light',
  rejected: 'destructive-light',
} as const;

/** Ajustes → Clientes → Organizações e marcas: uma linha por organização, com as marcas dela. */
export function OrganizationsTable({ rows }: { rows: OrganizationRow[] }) {
  const { t } = useI18n();
  const T = t.platformStaff;
  return (
    <SettingsSection title={T.title} description={T.description}>
      <Frame>
        <FramePanel className="p-0">
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.columns.organization}</TableHead>
                  <TableHead>{T.columns.brands}</TableHead>
                  <TableHead>{T.columns.country}</TableHead>
                  <TableHead>{T.columns.tier}</TableHead>
                  <TableHead>{T.columns.review}</TableHead>
                  <TableHead>{T.columns.members}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/settings/organizations/${o.id}`} className="font-medium hover:underline">
                          {o.name}
                        </Link>
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          {o.slug}
                          {o.isGalaxie ? (
                            <Badge variant="primary-light" size="sm">
                              {T.galaxie}
                            </Badge>
                          ) : null}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.brands.length ? (
                        <div className="flex flex-wrap gap-1">
                          {o.brands.map((b) => (
                            <Badge key={b.id} variant={b.status === 'active' ? 'secondary' : 'warning-light'}>
                              {b.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{T.noBrands}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {o.country} · {o.currency.toUpperCase()} · {T.entity[o.billingEntity as 'llc' | 'ltda']}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{o.capacityTier}</TableCell>
                    <TableCell>
                      <Badge variant={REVIEW_VARIANT[o.reviewStatus]} radius="full">
                        {T.review[o.reviewStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{fill(T.membersCount, { n: o.members })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ExplainEmpty title={T.emptyTitle} description={T.emptyDescription} />
          )}
        </FramePanel>
      </Frame>
    </SettingsSection>
  );
}
