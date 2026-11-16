import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.signups };
}

/**
 * Ajustes → Clientes → Cadastros e trials (#1136, F2): o liga/desliga do cadastro em autoatendimento, a versão dos
 * termos aceita, o limite por IP e o prazo do trial. A fila de cadastros a aprovar fica em Organizações e marcas.
 */
export default function Page() {
  return <OpsViewPage view="signups" />;
}
