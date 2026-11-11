'use client';

import { settingDef } from '@galaxie/runtime-config';
import { ArrowUpRight, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { secretSource } from '@/components/settings/blocks/logic';
import { SecretDialog } from '@/components/settings/blocks/secret-dialog';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { settingHref, settingPage } from '@/lib/ops/setting-page';
import type { OpsSnapshot } from '@/lib/ops/types';

import { displayValue, settingText } from './format';

/** Provedor que acompanha um modelo (`AI_RIGHTS_MODEL` → `AI_RIGHTS_PROVIDER`; os do nível, `AI_PROVIDER`). */
function providerKey(modelKey: string): string | null {
  if (/^AI_MODEL_/.test(modelKey)) return 'AI_PROVIDER';
  const key = modelKey.replace(/_MODEL$/, '_PROVIDER');
  return key !== modelKey && settingDef(key) ? key : null;
}

/**
 * Linha de um ajuste que mora em outra página (#1070): o modelo de IA em uso (A3) ou de onde vem a chave (A4), com o
 * link que abre a página dele já na linha (`/ajustes/ia#AI_RIGHTS_MODEL`). Chave que o painel troca (#1087) tem
 * "Trocar" aqui mesmo, no mesmo diálogo de Credenciais.
 */
export function SettingLink({ settingKey, snapshot }: { settingKey: string; snapshot: OpsSnapshot }) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const [changing, setChanging] = useState(false);
  const def = settingDef(settingKey);
  const setting = snapshot.settings.find((s) => s.key === settingKey);
  const page = settingPage(settingKey);
  const href = settingHref(settingKey);
  if (!def || !setting || !page || !href) return null;
  const value = (key: string) => {
    const d = settingDef(key);
    const s = snapshot.settings.find((x) => x.key === key);
    return d && s ? displayValue(T, d, s.value, { locale, defaultValue: s.defaultValue }) : null;
  };
  const provider = def.type === 'secret' ? null : providerKey(settingKey);
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{settingText(T, def).label}</span>
        <code className="text-muted-foreground font-mono text-xs">{settingKey}</code>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {def.type === 'secret' ? (
          <SecretBadge setting={setting} />
        ) : (
          <span className="text-muted-foreground">
            {T.settingLink.modelInUse}:{' '}
            <span className="text-foreground font-medium">
              {[provider ? value(provider) : null, value(settingKey)].filter(Boolean).join(' · ')}
            </span>
          </span>
        )}
        <Link
          href={href}
          className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          {fill(T.settingLink.open, { page: T.nav[page.item] })}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
        {setting.secret?.editable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>
            <KeyRound />
            {T.settingLink.change}
          </Button>
        ) : null}
      </div>
      {setting.secret?.editable ? (
        <SecretDialog
          key={changing ? 'aberto' : 'fechado'}
          setting={changing ? setting : null}
          onClose={() => setChanging(false)}
        />
      ) : null}
    </div>
  );
}

/** De onde vem a chave: painel (com o final dela), .env, não abre ou faltando. Nunca o valor. */
function SecretBadge({ setting }: { setting: OpsSnapshot['settings'][number] }) {
  const { t } = useI18n();
  const T = t.ops;
  const source = secretSource(setting);
  if (source === 'panel')
    return (
      <Badge variant="success-light">
        {setting.secret?.hint
          ? fill(T.secretKeys.sourcePanelHint, { hint: setting.secret.hint })
          : T.secretKeys.sourcePanel}
      </Badge>
    );
  if (source === 'unreadable') return <Badge variant="warning-light">{T.blocks.status.unreadable}</Badge>;
  return (
    <Badge variant={source === 'env' ? 'success-light' : 'warning-light'}>
      {source === 'env' ? T.settingLink.configured : T.settingLink.missing}
    </Badge>
  );
}

/** Cartão com as linhas de ajustes desta página que se editam em outra (modelos de IA ou chaves). */
export function SettingLinks({
  keys,
  kind,
  snapshot,
}: {
  keys: readonly string[];
  kind: 'models' | 'keys';
  snapshot: OpsSnapshot;
}) {
  const { t } = useI18n();
  const T = t.ops.settingLink;
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{T.movedTitle}</FrameTitle>
          <FrameDescription>{kind === 'models' ? T.movedModels : T.movedKeys}</FrameDescription>
        </FrameHeader>
        {keys.map((key) => (
          <SettingLink key={key} settingKey={key} snapshot={snapshot} />
        ))}
      </FramePanel>
    </Frame>
  );
}
