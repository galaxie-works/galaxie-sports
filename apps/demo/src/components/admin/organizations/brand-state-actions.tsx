'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { brandStateAction, type IssuedBrandKeys } from '@/app/[locale]/(app)/settings/organizations/actions';
import { ReasonDialog } from '@/components/admin/cosmos/reason-dialog';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  brandActionsFor,
  type BrandStateAction,
  type OrganizationBrand,
  type TenantState,
} from '@/lib/client/organizations-shared';
import { useI18n } from '@/lib/i18n/client';

import { IssuedKeysDialog } from './issued-keys-dialog';

/** Cor do crachá por estado (doc 02): verde com acesso, azul em teste, amarelo à espera ou com prazo, vermelho final. */
export const STATE_VARIANT = {
  draft: 'warning-light',
  pending_review: 'warning-light',
  rejected: 'destructive-light',
  trial: 'info-light',
  trial_expired: 'warning-light',
  active: 'success-light',
  past_due: 'warning-light',
  suspended: 'destructive-light',
  cancelled: 'destructive-light',
} as const satisfies Record<TenantState, string>;

export function BrandStateBadge({ state }: { state: TenantState }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATE_VARIANT[state]} radius="full">
      {t.platformStaff.state[state]}
    </Badge>
  );
}

/** Fim do trial sugerido ao estender: 14 dias depois do prazo atual (ou de hoje), no formato do input de data. */
function suggestedTrialEnd(current: string | null): string {
  const base = current && new Date(current).getTime() > Date.now() ? new Date(current) : new Date();
  return new Date(base.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
}

function BrandAction({
  brand,
  action,
  onIssued,
}: {
  brand: OrganizationBrand;
  action: BrandStateAction;
  onIssued: (i: IssuedBrandKeys[]) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const T = t.platformStaff.brand;
  const [until, setUntil] = useState(() => suggestedTrialEnd(brand.trialEndsAt));
  const extend = action === 'extend_trial';
  return (
    <ReasonDialog
      trigger={
        <Button size="sm" variant={action === 'approve' || action === 'reactivate' ? 'default' : 'outline'}>
          {T.actions[action]}
        </Button>
      }
      title={`${T.actions[action]} · ${brand.name}`}
      description={T.descriptions[action]}
      canConfirm={!extend || Boolean(until)}
      onOpen={() => setUntil(suggestedTrialEnd(brand.trialEndsAt))}
      onConfirm={async (reason) => {
        const r = await brandStateAction({
          tenantId: brand.id,
          action,
          reason,
          ...(extend ? { trialEndsAt: new Date(`${until}T23:59:59Z`).toISOString() } : {}),
        });
        if (r.ok) {
          router.refresh();
          if (r.issued?.length) onIssued(r.issued);
        }
        return r;
      }}
    >
      {extend ? (
        <Field>
          <FieldLabel htmlFor={`trial-until-${brand.id}`}>{T.extendUntil}</FieldLabel>
          <Input
            id={`trial-until-${brand.id}`}
            type="date"
            value={until}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>
      ) : null}
    </ReasonDialog>
  );
}

/** As ações da equipe sobre o estado da marca que cabem no estado atual (F3, decisão 7); as chaves emitidas ao aprovar aparecem uma vez. */
export function BrandStateActions({ brand }: { brand: OrganizationBrand }) {
  const { t } = useI18n();
  const [issued, setIssued] = useState<IssuedBrandKeys[] | null>(null);
  const actions = brandActionsFor(brand.state);
  if (!actions.length)
    return <span className="text-muted-foreground text-xs">{t.platformStaff.brand.final}</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actions.map((a) => (
        <BrandAction key={a} brand={brand} action={a} onIssued={setIssued} />
      ))}
      <IssuedKeysDialog
        issued={issued}
        notice={t.platformStaff.keys.approved}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}
