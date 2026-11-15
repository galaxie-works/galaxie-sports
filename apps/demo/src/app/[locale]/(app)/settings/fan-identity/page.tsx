import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.fanIdentity };
}

/** Ajustes → Engajamento → Identidade do torcedor: a validade do token gft_ (#937). */
export default function Page() {
  return <OpsViewPage view="fanIdentity" />;
}
