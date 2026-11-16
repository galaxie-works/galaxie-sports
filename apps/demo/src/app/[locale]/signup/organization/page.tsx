import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/auth/auth-shell';
import { OrganizationWizard } from '@/components/signup/organization-wizard';
import { isStaffRole, roleOf } from '@/lib/auth/roles';
import { auth, isAccessExpired } from '@/lib/auth/server';
import { catalog } from '@/lib/client/entitlements';
import { getT } from '@/lib/i18n/server';
import { hasAnyMembership } from '@/lib/signup/guards';
import { SIGNUP_MARKETS } from '@/lib/signup/organization';
import { readStartingPrices } from '@/lib/signup/prices';
import { readSignupSettings } from '@/lib/signup/settings-db';
import { SPORT_FAMILIES } from '@/lib/sport-families';

// A tela lê a chave do cadastro e a sessão a cada pedido: nada aqui é pré-renderizado no build (sem banco lá).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.signup.meta.organization, robots: { index: false, follow: false } };
}

/**
 * Assistente de criação da organização (doc 02 §Cadastro): só para quem entrou e ainda não tem cargo em marca
 * nenhuma. Quem já tem vai ao painel; a equipe Galaxie cria clientes em Ajustes. Lê o catálogo (faixas de capacidade),
 * os preços "a partir de" de cada mercado e os esportes, e entrega tudo ao assistente como dado.
 */
export default async function SignupOrganizationPage() {
  const [t, settings, session] = await Promise.all([
    getT(),
    readSignupSettings(),
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!session || isAccessExpired(session.user)) redirect('/signup');
  const role = roleOf(session.user.role);
  if (isStaffRole(role)) redirect('/settings/organizations');
  if (role !== 'client') redirect('/');
  if (!settings.open || !settings.termsVersion) redirect('/signup');
  if (await hasAnyMembership(session.user.id)) redirect('/client');

  const c = catalog();
  const prices = Object.fromEntries(
    await Promise.all(SIGNUP_MARKETS.map(async (m) => [m, await readStartingPrices(m)] as const)),
  );
  const sports = SPORT_FAMILIES.map((f) => ({
    id: f.id,
    sports: [...f.sports],
    label: t.nav.families[f.id as keyof typeof t.nav.families] ?? f.slug,
  }));
  const S = t.signup.shell;
  return (
    <AuthShell wide title={S.organizationTitle} subtitle={S.organizationSubtitle}>
      <OrganizationWizard
        termsVersion={settings.termsVersion}
        tiers={c.capacity.tiers}
        prices={prices}
        sports={sports}
      />
    </AuthShell>
  );
}
