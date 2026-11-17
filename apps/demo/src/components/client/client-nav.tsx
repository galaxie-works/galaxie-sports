'use client';

import { GroupedNavSheet, GroupedSideNav } from '@/components/settings/grouped-nav';
import { useI18n } from '@/lib/i18n/client';

import { clientNavGroups, type ClientSection } from './client-nav-shared';

/** Menu lateral do painel do cliente no computador (coluna de 240 px). */
export function ClientSideNav({
  active,
  visible,
  className,
}: {
  active: ClientSection;
  visible?: readonly ClientSection[];
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <GroupedSideNav
      groups={clientNavGroups(t.client.nav, visible)}
      active={active}
      label={t.client.nav.label}
      className={className}
    />
  );
}

/** O mesmo menu no celular, numa gaveta aberta pelo botão do topo (fecha ao navegar). */
export function ClientNavSheet({
  active,
  visible,
  className,
}: {
  active: ClientSection;
  visible?: readonly ClientSection[];
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <GroupedNavSheet
      groups={clientNavGroups(t.client.nav, visible)}
      active={active}
      label={t.client.nav.label}
      title={t.client.title}
      className={className}
    />
  );
}
