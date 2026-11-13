'use client';

import {
  SHOP_DESTINATION_QUESTIONS,
  SHOP_DESTINATION_RULES_VERSION,
  evaluateShopDestination,
  type ShopDestinationAnswers,
  type ShopDestinationQuestion,
} from '@galaxie/engage';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { compareAlpha } from '@/lib/alphabetical';
import { SHOP_CLIENT_CODE } from '@/lib/builder/config';
import type { ShopStoreChoice, WidgetShopConfig, WidgetShopStore } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

type Answers = Partial<ShopDestinationAnswers>;

const complete = (a: Answers): a is ShopDestinationAnswers =>
  SHOP_DESTINATION_QUESTIONS.every((q) => typeof a[q] === 'boolean');

const sameAnswers = (a: Answers, b: Answers | undefined) =>
  !!b && SHOP_DESTINATION_QUESTIONS.every((q) => a[q] === b[q]);

/**
 * Shopping no Builder (#925): as lojas do widget, na ordem do cliente, com o caminho de cada uma (código próprio ou
 * repasse pela Galaxie), e a checagem de destino (#927) que libera só as lojas e os caminhos permitidos ali. Só
 * lojas do mercado do widget que a Galaxie liberou para clientes aparecem; a API confere tudo de novo.
 */
export function ShopWidgetEditor({
  value,
  market,
  stores,
  onChange,
}: {
  value: WidgetShopConfig | undefined;
  market: string;
  stores: ShopStoreChoice[];
  onChange: (next: WidgetShopConfig) => void;
}) {
  const { t, locale } = useI18n();
  const T = t.shopping.builder;
  const C = T.check;
  const current: WidgetShopConfig = value ?? { stores: [] };
  const confirmed = current.destination;
  const [answers, setAnswers] = useState<Answers>(confirmed?.answers ?? {});

  const available = stores
    .filter((s) => s.country === market && s.clientPaths.length)
    .sort((a, b) => compareAlpha(a.name, b.name));
  const byId = new Map(available.map((s) => [s.id, s]));
  const chosen = current.stores.filter((s) => byId.has(s.storeId));
  const unused = available.filter((s) => !chosen.some((c) => c.storeId === s.id));
  // lojas salvas que não estão na lista (outro mercado, loja desligada): à mostra para o cliente tirar, nunca
  // escondidas na configuração
  const hidden = current.stores.filter((s) => !byId.has(s.storeId));
  // o que vale para mostrar: as respostas na tela, quando completas; senão, as confirmadas
  const shown = complete(answers) ? answers : confirmed?.answers;
  const verdict = shown
    ? new Map(
        evaluateShopDestination(
          shown,
          available.map((s) => ({ id: s.id, network: s.network, clientPaths: s.clientPaths })),
        ).stores.map((r) => [r.storeId, r]),
      )
    : null;

  const setStores = (next: WidgetShopStore[]) => onChange({ ...current, stores: [...next, ...hidden] });
  const update = (i: number, patch: Partial<WidgetShopStore>) =>
    setStores(chosen.map((s, j) => (j === i ? ({ ...s, ...patch } as WidgetShopStore) : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...chosen];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    setStores(next);
  };
  const add = (s: ShopStoreChoice) =>
    setStores([
      ...chosen,
      s.clientPaths.includes('subnetwork')
        ? { storeId: s.id, path: 'subnetwork' }
        : { storeId: s.id, path: 'client_code', clientCode: '' },
    ]);
  const confirm = () => {
    if (!complete(answers)) return;
    onChange({
      ...current,
      destination: {
        answers,
        rulesVersion: SHOP_DESTINATION_RULES_VERSION,
        confirmedAt: new Date().toISOString(),
      },
    });
  };

  const status = !confirmed
    ? C.pending
    : confirmed.rulesVersion !== SHOP_DESTINATION_RULES_VERSION
      ? C.stale
      : !sameAnswers(answers, confirmed.answers)
        ? C.changed
        : fill(C.confirmed, { when: new Date(confirmed.confirmedAt).toLocaleString(locale) });
  const ok =
    !!confirmed &&
    confirmed.rulesVersion === SHOP_DESTINATION_RULES_VERSION &&
    sameAnswers(answers, confirmed.answers);

  return (
    <>
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>{C.title}</FrameTitle>
            <FrameDescription>{C.description}</FrameDescription>
          </FrameHeader>
          {SHOP_DESTINATION_QUESTIONS.map((q: ShopDestinationQuestion) => (
            <div key={q} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">{C.questions[q]}</span>
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                aria-label={C.questions[q]}
                value={answers[q] === undefined ? [] : [answers[q] ? 'yes' : 'no']}
                onValueChange={(next) => {
                  const v = next[0];
                  if (v === 'yes' || v === 'no') setAnswers((a) => ({ ...a, [q]: v === 'yes' }));
                }}
              >
                <ToggleGroupItem value="yes">{C.yes}</ToggleGroupItem>
                <ToggleGroupItem value="no">{C.no}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          ))}
          {shown?.mobileApp ? <p className="text-muted-foreground text-xs">{C.webView}</p> : null}
          {shown?.rewardsArea ? <p className="text-muted-foreground text-xs">{C.rewards}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!complete(answers) || ok} onClick={confirm}>
              {C.confirm}
            </Button>
            <span
              className={ok ? 'text-muted-foreground text-xs' : 'text-xs text-amber-600 dark:text-amber-400'}
            >
              {status}
            </span>
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>{T.title}</FrameTitle>
            <FrameDescription>{T.description}</FrameDescription>
          </FrameHeader>
          {!available.length ? (
            <Alert>
              <AlertDescription>{fill(T.noStores, { market })}</AlertDescription>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-3">
            {chosen.map((s, i) => {
              const store = byId.get(s.storeId)!;
              const r = verdict?.get(s.storeId);
              const codeId = `shop-code-${s.storeId}`;
              const codeBad = s.path === 'client_code' && !SHOP_CLIENT_CODE.test((s.clientCode ?? '').trim());
              return (
                <li key={s.storeId} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium">{store.name}</span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={T.moveUp}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={T.moveDown}
                      disabled={i === chosen.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={T.remove}
                      onClick={() => setStores(chosen.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    spacing={0}
                    aria-label={store.name}
                    value={[s.path]}
                    onValueChange={(next) => {
                      const v = next[0];
                      if (v === 'subnetwork') update(i, { path: 'subnetwork', clientCode: undefined });
                      else if (v === 'client_code')
                        update(i, { path: 'client_code', clientCode: s.clientCode ?? '' });
                    }}
                  >
                    {store.clientPaths.map((p) => (
                      <ToggleGroupItem key={p} value={p}>
                        {T.paths[p]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {s.path === 'client_code' ? (
                    <Field>
                      <FieldLabel htmlFor={codeId}>{T.clientCode}</FieldLabel>
                      <Input
                        id={codeId}
                        value={s.clientCode ?? ''}
                        maxLength={64}
                        aria-invalid={codeBad || undefined}
                        onChange={(ev) => update(i, { clientCode: ev.target.value })}
                      />
                      {codeBad ? <FieldDescription>{T.clientCodeInvalid}</FieldDescription> : null}
                    </Field>
                  ) : null}
                  {r && (!r.allowed || !r.paths.includes(s.path)) ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {fill(T.blockedHere, { reason: C.blocked[r.blocked ?? 'no_path'] })}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {hidden.map((s) => (
              <li
                key={s.storeId}
                className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-3"
              >
                <span className="flex-1 truncate text-xs">
                  {fill(T.unavailable, { store: s.storeId, market })}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={T.remove}
                  onClick={() =>
                    onChange({ ...current, stores: current.stores.filter((x) => x.storeId !== s.storeId) })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          {unused.length ? (
            <div className="flex flex-wrap gap-2">
              {unused.map((s) => (
                <Button key={s.id} size="sm" variant="outline" onClick={() => add(s)}>
                  <Plus aria-hidden />
                  {s.name}
                </Button>
              ))}
            </div>
          ) : null}
        </FramePanel>
      </Frame>
    </>
  );
}
