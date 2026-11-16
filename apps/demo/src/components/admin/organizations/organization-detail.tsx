'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  updateOrganizationAction,
  type IssuedBrandKeys,
} from '@/app/[locale]/(app)/settings/organizations/actions';
import { ReasonDialog } from '@/components/admin/cosmos/reason-dialog';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { OrganizationMemberRow } from '@/lib/client/members';
import {
  CAPACITY_TIERS,
  REVIEW_STATUSES,
  type CapacityTier,
  type OrganizationRow,
  type ReviewStatus,
} from '@/lib/client/organizations-shared';
import type { StaffActionRow } from '@/lib/client/staff';
import { useFormatters, useI18n } from '@/lib/i18n/client';

import { IssuedKeysDialog } from './issued-keys-dialog';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * Edição da organização com motivo: faixa de capacidade, revisão do cadastro e cliente zero. Aprovar a revisão emite
 * as chaves que faltavam (o cadastro em revisão nasce sem elas): aparecem uma vez, numa janela depois desta.
 */
function EditDialog({
  organization,
  onIssued,
}: {
  organization: OrganizationRow;
  onIssued: (issued: IssuedBrandKeys[]) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const T = t.platformStaff;
  const [tier, setTier] = useState<CapacityTier>(organization.capacityTier);
  const [review, setReview] = useState<ReviewStatus>(organization.reviewStatus);
  const [galaxie, setGalaxie] = useState(organization.isGalaxie);
  const tiers = CAPACITY_TIERS.map((v) => ({ value: v, label: v }));
  const reviews = REVIEW_STATUSES.map((v) => ({ value: v, label: T.review[v] }));
  const changed =
    tier !== organization.capacityTier ||
    review !== organization.reviewStatus ||
    galaxie !== organization.isGalaxie;
  return (
    <ReasonDialog
      trigger={<Button size="sm">{T.detail.edit}</Button>}
      title={T.detail.editTitle}
      description={T.detail.editDescription}
      canConfirm={changed}
      onOpen={() => {
        setTier(organization.capacityTier);
        setReview(organization.reviewStatus);
        setGalaxie(organization.isGalaxie);
      }}
      onConfirm={async (reason) => {
        const r = await updateOrganizationAction({
          id: organization.id,
          capacityTier: tier,
          reviewStatus: review,
          isGalaxie: galaxie,
          reason,
        });
        if (r.ok) {
          router.refresh();
          if (r.issued?.length) onIssued(r.issued);
        }
        return r;
      }}
    >
      <Field>
        <FieldLabel>{T.columns.tier}</FieldLabel>
        <Select items={tiers} value={tier} onValueChange={(v) => v && setTier(v as CapacityTier)}>
          <SelectTrigger aria-label={T.columns.tier}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tiers.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{T.columns.review}</FieldLabel>
        <Select items={reviews} value={review} onValueChange={(v) => v && setReview(v as ReviewStatus)}>
          <SelectTrigger aria-label={T.columns.review}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {reviews.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="org-galaxie" checked={galaxie} onCheckedChange={(v) => setGalaxie(v === true)} />
        <FieldLabel htmlFor="org-galaxie">{T.detail.isGalaxie}</FieldLabel>
      </Field>
    </ReasonDialog>
  );
}

/** A edição e, depois de aprovar a revisão, as chaves emitidas. */
function EditWithKeys({ organization }: { organization: OrganizationRow }) {
  const { t } = useI18n();
  const [issued, setIssued] = useState<IssuedBrandKeys[] | null>(null);
  return (
    <>
      <EditDialog organization={organization} onIssued={setIssued} />
      <IssuedKeysDialog
        issued={issued}
        notice={t.platformStaff.keys.approved}
        onClose={() => setIssued(null)}
      />
    </>
  );
}

/** Ficha da organização, as marcas, Donos e Financeiro, e as ações da equipe sobre ela e as marcas. */
export function OrganizationDetail({
  organization,
  members,
  actions,
  timeZone,
}: {
  organization: OrganizationRow;
  members: OrganizationMemberRow[];
  actions: StaffActionRow[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.platformStaff;
  const roles = t.client.members.roles;
  const fmt = useFormatters(timeZone);
  const brandName = (id: string | null) => organization.brands.find((b) => b.id === id)?.name ?? null;
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={organization.name}
        description={T.detail.description}
        action={<EditWithKeys organization={organization} />}
      >
        <Frame>
          <FramePanel className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={T.columns.slug}>{organization.slug}</Fact>
            <Fact label={T.columns.country}>
              {organization.country} · {organization.currency.toUpperCase()} ·{' '}
              {T.entity[organization.billingEntity as 'llc' | 'ltda']}
            </Fact>
            <Fact label={T.columns.tier}>{organization.capacityTier}</Fact>
            <Fact label={T.columns.review}>{T.review[organization.reviewStatus]}</Fact>
            <Fact label={T.detail.isGalaxie}>{organization.isGalaxie ? T.yes : T.no}</Fact>
            <Fact label={T.columns.created}>{fmt.date(organization.createdAt)}</Fact>
          </FramePanel>
        </Frame>
      </SettingsSection>

      <SettingsSection title={T.detail.brands} description={T.detail.brandsDescription}>
        <Frame>
          <FramePanel className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.columns.brand}</TableHead>
                  <TableHead>{T.columns.plan}</TableHead>
                  <TableHead>{T.columns.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organization.brands.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/settings/wallets/${b.id}`} className="font-medium hover:underline">
                        {b.name}
                      </Link>
                      <span className="text-muted-foreground ml-2 text-xs">{b.slug}</span>
                    </TableCell>
                    <TableCell className="text-sm">{b.plan}</TableCell>
                    <TableCell>
                      <Badge
                        variant={b.status === 'active' ? 'success-light' : 'warning-light'}
                        radius="full"
                      >
                        {t.client.tenant.status[b.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FramePanel>
        </Frame>
      </SettingsSection>

      <SettingsSection title={T.detail.members} description={T.detail.membersDescription}>
        <Frame>
          <FramePanel className="p-0">
            {members.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.client.members.email}</TableHead>
                    <TableHead>{t.client.members.role}</TableHead>
                    <TableHead>{t.client.members.since}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.memberId}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{m.name}</span>
                          <span className="text-muted-foreground text-xs">{m.email}</span>
                          {m.status !== 'active' ? (
                            <Badge
                              variant={m.status === 'expired' ? 'destructive-light' : 'warning-light'}
                              size="sm"
                              className="w-fit"
                            >
                              {m.status === 'expired' ? t.client.members.expired : t.client.members.pending}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{roles[m.role]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {fmt.date(m.invitedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground p-4 text-sm">{T.detail.noMembers}</p>
            )}
          </FramePanel>
        </Frame>
      </SettingsSection>

      <SettingsSection title={T.actions.title} description={T.actions.description}>
        <Frame>
          <FramePanel className="p-0">
            {actions.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.actions.when}</TableHead>
                    <TableHead>{T.actions.who}</TableHead>
                    <TableHead>{T.actions.what}</TableHead>
                    <TableHead>{T.actions.target}</TableHead>
                    <TableHead>{T.actions.reason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {fmt.dateTime(a.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{a.actorEmail ?? a.actor}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{a.action}</code>
                      </TableCell>
                      <TableCell className="text-sm">
                        {brandName(a.tenantId) ?? T.actions.organization}
                      </TableCell>
                      <TableCell className="text-sm">{a.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground p-4 text-sm">{T.actions.empty}</p>
            )}
          </FramePanel>
        </Frame>
      </SettingsSection>
    </div>
  );
}
