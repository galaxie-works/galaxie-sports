'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  clearCredentialsAction,
  saveConnectorAction,
  saveCredentialsAction,
  setStoreActiveAction,
  type ShopActionResult,
} from '@/app/[locale]/(app)/ajustes/shopping/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import {
  SHOP_CLIENT_PATHS,
  SUBNETWORK_NETWORKS,
  TEMPLATE_NETWORKS,
  type ShopClientPath,
} from '@/lib/shop/catalog-input';
import type { ShopConnectorView } from '@/lib/shop/connectors';

function useAction() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<ShopActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? t.shopping.errors.generic);
      toast.success(t.shopping.done);
      after?.();
      router.refresh();
    });
  return { pending, go };
}

/**
 * Ajustes → Engajamento → Shopping → Conectores (#916): por loja, liga/desliga, a matriz loja × caminho do widget do
 * cliente, a configuração na rede e as credenciais da Galaxie (só gravação).
 */
export function ShoppingConnectors({ stores, timeZone }: { stores: ShopConnectorView[]; timeZone: string }) {
  const { t } = useI18n();
  const T = t.shopping.connectors;
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/ajustes/shopping"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {T.back}
      </Link>
      <p className="text-muted-foreground text-sm">{T.description}</p>
      {stores.length ? (
        stores.map((s) => <ConnectorCard key={`${s.id}:${s.updatedAt}`} store={s} timeZone={timeZone} />)
      ) : (
        <p className="text-muted-foreground text-sm">{T.empty}</p>
      )}
    </div>
  );
}

function ConnectorCard({ store, timeZone }: { store: ShopConnectorView; timeZone: string }) {
  const { t } = useI18n();
  const T = t.shopping.connectors;
  const f = useFormatters(timeZone);
  const { pending, go } = useAction();
  const [paths, setPaths] = useState<ShopClientPath[]>(store.clientPaths);
  const [advertiserId, setAdvertiserId] = useState(store.advertiserId ?? '');
  const [linkTemplate, setLinkTemplate] = useState(store.linkTemplate ?? '');
  const [creds, setCreds] = useState({ affiliateId: '', affiliateTool: '', apiToken: '', apiSecret: '' });
  const canSubnetwork = SUBNETWORK_NETWORKS.includes(store.network);
  // a consulta à loja só acontece com o token gravado; sem ele, o Mercado Livre também fica no link curado
  const live = store.network === 'mercado_livre' && store.hasCredentials;
  const id = (k: string) => `shop-conn-${store.id}-${k}`;

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4 p-4">
        <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-0">
          <div className="flex flex-col gap-1">
            <FrameTitle className="flex items-center gap-2">
              {store.name}
              <Badge variant="secondary">{store.country}</Badge>
            </FrameTitle>
            <FrameDescription>
              {t.shopping.networks[store.network]} · {live ? T.mode.live : T.mode.curated}
            </FrameDescription>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={store.active}
              disabled={pending}
              onCheckedChange={(v) => go(() => setStoreActiveAction(store.id, v === true))}
            />
            {T.active}
          </label>
        </FrameHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{T.paths}</p>
            {SHOP_CLIENT_PATHS.map((p) => {
              const disabled =
                (p === 'subnetwork' && !canSubnetwork) ||
                (p === 'client_code' && TEMPLATE_NETWORKS.includes(store.network));
              return (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={paths.includes(p)}
                    disabled={disabled || pending}
                    onCheckedChange={(v) =>
                      setPaths((cur) => (v === true ? [...cur, p] : cur.filter((x) => x !== p)))
                    }
                  />
                  {T.clientPaths[p]}
                  {disabled ? (
                    <span className="text-muted-foreground text-xs">
                      ({p === 'subnetwork' ? T.subnetworkOff : T.clientCodeOff})
                    </span>
                  ) : null}
                </label>
              );
            })}
            <p className="text-muted-foreground text-xs">{T.pathsHint}</p>
            {store.network === 'awin' ? (
              <Field>
                <FieldLabel htmlFor={id('adv')}>{T.advertiserId}</FieldLabel>
                <Input
                  id={id('adv')}
                  className="font-mono"
                  value={advertiserId}
                  maxLength={64}
                  onChange={(e) => setAdvertiserId(e.target.value)}
                />
              </Field>
            ) : null}
            {TEMPLATE_NETWORKS.includes(store.network) ? (
              <Field>
                <FieldLabel htmlFor={id('tpl')}>{T.linkTemplate}</FieldLabel>
                <Input
                  id={id('tpl')}
                  className="font-mono"
                  value={linkTemplate}
                  maxLength={2000}
                  onChange={(e) => setLinkTemplate(e.target.value)}
                />
                <FieldDescription>{T.linkTemplateHint}</FieldDescription>
              </Field>
            ) : null}
            <div>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  go(() => saveConnectorAction(store.id, { clientPaths: paths, advertiserId, linkTemplate }))
                }
              >
                {T.saveConfig}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{T.credentials}</p>
              {store.hasCredentials ? (
                <Badge variant="success-light">
                  {fill(T.credentialsSet, {
                    when: f.relative(store.credentialsUpdatedAt ?? store.updatedAt),
                  })}
                  {store.credentialsHint ? ` · ${store.credentialsHint}` : ''}
                </Badge>
              ) : (
                <Badge variant="warning-light">{T.credentialsNone}</Badge>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['affiliateId', 'affiliateTool', 'apiToken', 'apiSecret'] as const).map((k) => (
                <Field key={k}>
                  <FieldLabel htmlFor={id(k)}>{T[k]}</FieldLabel>
                  <Input
                    id={id(k)}
                    type={k.startsWith('api') ? 'password' : 'text'}
                    autoComplete="off"
                    className="font-mono"
                    value={creds[k]}
                    maxLength={2000}
                    onChange={(e) => setCreds((c) => ({ ...c, [k]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || (!store.hasCredentials && !creds.affiliateId.trim())}
                onClick={() =>
                  go(
                    () => saveCredentialsAction(store.id, creds),
                    () => setCreds({ affiliateId: '', affiliateTool: '', apiToken: '', apiSecret: '' }),
                  )
                }
              >
                {pending ? <Spinner /> : null}
                {T.saveCredentials}
              </Button>
              {store.hasCredentials ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => go(() => clearCredentialsAction(store.id))}
                >
                  {T.clearCredentials}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}
