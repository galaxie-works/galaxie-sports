import { ArrowUpRight } from 'lucide-react';

import { SettingsArea } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n/server';
import { SETTINGS_EPIC_URL, type SoonItemId, settingsItem } from '@/lib/ops/settings-items';

/**
 * Página de espera de um item planejado de Ajustes (decisão A5, #1068): o que a tela vai ter, a fase ou onda e o link
 * para a issue da feature (ou o épico da navegação, quando ela ainda não tem issue). Sem dados reais.
 */
export async function SoonPage({ id }: { id: SoonItemId }) {
  const t = await getT();
  const T = t.ops.soon;
  const item = settingsItem(id);
  const href = 'soon' in item ? item.soon.href : SETTINGS_EPIC_URL;
  const text = T.items[id];
  return (
    <>
      <PageHeader title={t.ops.nav[id]} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active={id}>
          <Frame>
            <FramePanel className="flex flex-col gap-4 p-6">
              <FrameHeader className="flex flex-col gap-2 p-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FrameTitle className="text-base">{t.ops.nav[id]}</FrameTitle>
                  <Badge variant="secondary">{T.badge}</Badge>
                </div>
                <FrameDescription>{T.lead}</FrameDescription>
              </FrameHeader>
              <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">{T.what}</dt>
                <dd>{text.what}</dd>
                <dt className="text-muted-foreground">{T.when}</dt>
                <dd>
                  <Badge variant="info-light">{text.phase}</Badge>
                </dd>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-muted-foreground text-xs">{T.noData}</p>
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href={href} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                >
                  {href === SETTINGS_EPIC_URL ? T.epic : T.issue}
                  <ArrowUpRight aria-hidden="true" />
                </Button>
              </div>
            </FramePanel>
          </Frame>
        </SettingsArea>
      </div>
    </>
  );
}
