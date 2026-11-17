import type { TenantState } from '@galaxie/db/schema';
import { AlertTriangle, Clock, Info, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { buttonVariants } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { CONTACT_EMAIL } from '@/lib/site';

/** Estados com aviso no console (F3, decisão 8); `trial` e `active` não têm aviso (o trial mostra o prazo no cabeçalho). */
export type NoticeState = Exclude<TenantState, 'trial' | 'active'>;

type Texts = Dictionary['client']['tenant']['stateNotice'];

const VARIANT: Record<NoticeState, 'info' | 'warning' | 'destructive'> = {
  draft: 'info',
  pending_review: 'info',
  rejected: 'destructive',
  trial_expired: 'warning',
  past_due: 'warning',
  suspended: 'warning',
  cancelled: 'destructive',
};

const ICON: Record<NoticeState, typeof Info> = {
  draft: Clock,
  pending_review: Clock,
  rejected: ShieldAlert,
  trial_expired: AlertTriangle,
  past_due: AlertTriangle,
  suspended: AlertTriangle,
  cancelled: ShieldAlert,
};

/** Os estados que mandam o cliente à loja (planos e módulos) para regularizar. */
const WITH_STORE_LINK: readonly NoticeState[] = ['trial_expired', 'suspended', 'past_due'];

/**
 * O aviso do estado da conta (F3, decisão 8; doc 02 "O que cada estado permite"). `mode = 'banner'`: faixa acima do
 * conteúdo (`trial_expired`, `suspended`, `past_due`). `mode = 'screen'`: a única coisa que o console mostra
 * (`draft`, `pending_review`, `rejected`, `cancelled`). Para a equipe Galaxie num tenant de cliente, acrescenta que
 * aquele é o estado do cliente e que a equipe age em Ajustes › Organizações e marcas.
 */
export function TenantStateNotice({
  state,
  mode,
  staff,
  t,
}: {
  state: NoticeState;
  mode: 'banner' | 'screen';
  staff: boolean;
  t: Texts;
}) {
  const texts = t[state];
  const body = fill(texts.body, { email: CONTACT_EMAIL });
  const Icon = ICON[state];
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {WITH_STORE_LINK.includes(state) ? (
        <Link href="/client/plans" className={buttonVariants({ size: 'sm' })}>
          {t.openStore}
        </Link>
      ) : null}
      {state === 'rejected' || state === 'cancelled' ? (
        <a href={`mailto:${CONTACT_EMAIL}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {t.contact}
        </a>
      ) : null}
      {staff ? (
        <Link href="/settings/organizations" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {t.staffLink}
        </Link>
      ) : null}
    </div>
  );
  const staffNote = staff ? <p className="text-muted-foreground text-xs">{t.staff}</p> : null;

  if (mode === 'screen')
    return (
      <EmptyState title={texts.title} description={body}>
        <div className="flex flex-col items-center gap-3">
          {staffNote}
          {actions}
        </div>
      </EmptyState>
    );
  return (
    <Alert variant={VARIANT[state]} role="status">
      <Icon />
      <AlertTitle>{texts.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{body}</span>
        {staffNote}
        {actions}
      </AlertDescription>
    </Alert>
  );
}
