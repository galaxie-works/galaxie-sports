'use client';

import { ArrowDown, ArrowLeft, ArrowUp, Check, ExternalLink, Pencil, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  addProductAction,
  moveProductAction,
  removeLookupAction,
  reviewProductAction,
  saveLookupAction,
  saveProfileAction,
  setProductActiveAction,
  updateProductAction,
  type ShopActionResult,
} from '@/app/[locale]/(app)/ajustes/shopping/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import {
  ANCHORS_MAX,
  ANCHORS_MIN,
  SHOP_LOOKUP_KINDS,
  SHOP_PRODUCT_TYPES,
  type ShopLookupKind,
  type ShopProductType,
} from '@/lib/shop/catalog-input';
import type { ShopEntityDetail, ShopProductView, ShopStoreView } from '@/lib/shop/catalog';

type Ref = { kind: string; id: string };

/** Roda a ação, avisa o resultado e recarrega a página do servidor. */
function useAction() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<ShopActionResult>, ok: string = t.shopping.done, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? t.shopping.errors.generic);
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, go };
}

/**
 * Curadoria de uma entidade no Shopping (#914): a ficha (marca e temporada do uniforme), e por loja o jeito de achar
 * os produtos e os produtos âncora, com ordem, liga/desliga e revisão das sugestões da IA.
 */
export function ShoppingEntity({ detail, stores }: { detail: ShopEntityDetail; stores: ShopStoreView[] }) {
  const { t } = useI18n();
  const T = t.shopping;
  const ref: Ref = { kind: detail.entity.kind, id: detail.entity.id };
  const approved = detail.products.filter((p) => p.status === 'approved' && p.active).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/ajustes/shopping"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          {T.entity.back}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{detail.entity.name}</h2>
          <Badge variant="secondary">
            {T.subtypes[detail.entity.subtype as keyof typeof T.subtypes] ?? detail.entity.subtype}
          </Badge>
          <Badge variant={approved >= ANCHORS_MIN ? 'success-light' : 'warning-light'}>
            {fill(T.entity.approvedCount, { count: approved })}
          </Badge>
        </div>
      </div>

      <ProfileCard entityRef={ref} profile={detail.profile} />

      <p className="text-muted-foreground text-sm">
        {fill(T.entity.anchorsHint, { min: ANCHORS_MIN, max: ANCHORS_MAX })}
      </p>

      {stores.length ? (
        stores.map((s) => (
          <StoreCard
            key={s.id}
            entityRef={ref}
            store={s}
            lookup={detail.lookups.find((l) => l.storeId === s.id) ?? null}
            products={detail.products.filter((p) => p.storeId === s.id)}
          />
        ))
      ) : (
        <p className="text-muted-foreground text-sm">{T.entity.noStores}</p>
      )}
    </div>
  );
}

function ProfileCard({ entityRef, profile }: { entityRef: Ref; profile: ShopEntityDetail['profile'] }) {
  const { t } = useI18n();
  const T = t.shopping.entity;
  const { pending, go } = useAction();
  const [form, setForm] = useState({
    kitBrand: profile?.kitBrand ?? '',
    kitSeason: profile?.kitSeason ?? '',
    reviewedSeason: profile?.reviewedSeason ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4 p-4">
        <FrameHeader className="p-0">
          <FrameTitle>{T.profile}</FrameTitle>
          <FrameDescription>{T.profileDescription}</FrameDescription>
        </FrameHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="shop-kit-brand">{T.kitBrand}</FieldLabel>
            <Input id="shop-kit-brand" value={form.kitBrand} maxLength={40} onChange={set('kitBrand')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-kit-season">{T.kitSeason}</FieldLabel>
            <Input id="shop-kit-season" value={form.kitSeason} maxLength={7} onChange={set('kitSeason')} />
            <FieldDescription>{T.seasonHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-reviewed-season">{T.reviewedSeason}</FieldLabel>
            <Input
              id="shop-reviewed-season"
              value={form.reviewedSeason}
              maxLength={7}
              onChange={set('reviewedSeason')}
            />
            <FieldDescription>{T.seasonHint}</FieldDescription>
          </Field>
        </div>
        <div>
          <Button
            disabled={pending}
            onClick={() => go(() => saveProfileAction(entityRef, form), T.profileSaved)}
          >
            {pending ? <Spinner /> : null}
            {T.saveProfile}
          </Button>
        </div>
      </FramePanel>
    </Frame>
  );
}

function StoreCard({
  entityRef,
  store,
  lookup,
  products,
}: {
  entityRef: Ref;
  store: ShopStoreView;
  lookup: ShopEntityDetail['lookups'][number] | null;
  products: ShopProductView[];
}) {
  const { t, locale } = useI18n();
  const T = t.shopping;
  const { pending, go } = useAction();
  const [dialog, setDialog] = useState<ShopProductView | 'new' | null>(null);
  const [lk, setLk] = useState({
    lookupKind: lookup?.lookupKind ?? '',
    lookupValue: lookup?.lookupValue ?? '',
    pageUrl: lookup?.pageUrl ?? '',
  });
  const kinds = [...SHOP_LOOKUP_KINDS].sort((a, b) =>
    T.lookupKinds[a].localeCompare(T.lookupKinds[b], locale),
  );
  // a ordem vale entre os que não foram recusados; recusados ficam no fim, só para consulta
  const ordered = products.filter((p) => p.status !== 'rejected');

  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex flex-col gap-1">
            <FrameTitle className="flex items-center gap-2">
              {store.name}
              <Badge variant="secondary">{store.country}</Badge>
              {store.active ? null : <Badge variant="secondary">{T.stores.off}</Badge>}
            </FrameTitle>
            <FrameDescription>{T.networks[store.network]}</FrameDescription>
          </div>
          <Button size="sm" onClick={() => setDialog('new')}>
            <Plus />
            {T.products.add}
          </Button>
        </FrameHeader>

        <div className="flex flex-col gap-3 border-t p-4">
          <p className="text-sm font-medium">{T.lookup.title}</p>
          <div className="grid gap-3 md:grid-cols-[12rem_1fr_1fr_auto] md:items-end">
            <Field>
              <FieldLabel htmlFor={`shop-lk-kind-${store.id}`}>{T.lookup.kind}</FieldLabel>
              <Select
                value={lk.lookupKind}
                onValueChange={(v) => setLk((f) => ({ ...f, lookupKind: String(v ?? '') }))}
              >
                <SelectTrigger id={`shop-lk-kind-${store.id}`}>
                  <SelectValue placeholder={T.lookup.kind} />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {T.lookupKinds[k as ShopLookupKind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`shop-lk-value-${store.id}`}>{T.lookup.value}</FieldLabel>
              <Input
                id={`shop-lk-value-${store.id}`}
                value={lk.lookupValue}
                maxLength={500}
                onChange={(e) => setLk((f) => ({ ...f, lookupValue: e.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`shop-lk-page-${store.id}`}>{T.lookup.pageUrl}</FieldLabel>
              <Input
                id={`shop-lk-page-${store.id}`}
                type="url"
                placeholder={T.urlPlaceholder}
                value={lk.pageUrl}
                maxLength={2000}
                onChange={(e) => setLk((f) => ({ ...f, pageUrl: e.target.value }))}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  go(() => saveLookupAction(entityRef, { ...lk, storeId: store.id }), T.lookup.saved)
                }
              >
                {T.lookup.save}
              </Button>
              {lookup ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    go(
                      () => removeLookupAction(entityRef, store.id),
                      T.lookup.removed,
                      () => setLk({ lookupKind: '', lookupValue: '', pageUrl: '' }),
                    )
                  }
                >
                  {T.lookup.remove}
                </Button>
              ) : null}
            </div>
          </div>
          {lookup ? null : <p className="text-muted-foreground text-xs">{T.lookup.none}</p>}
        </div>

        {products.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.products.product}</TableHead>
                <TableHead>{T.products.type}</TableHead>
                <TableHead>{T.products.status}</TableHead>
                <TableHead>{T.products.active}</TableHead>
                <TableHead className="text-right">{T.products.order}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...ordered, ...products.filter((p) => p.status === 'rejected')].map((p) => {
                const i = ordered.indexOf(p);
                return (
                  <TableRow key={p.id} className={p.status === 'rejected' ? 'opacity-60' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-1 font-medium">
                        {p.title}
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={T.products.open}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {p.storeProductId}
                        {p.season ? ` · ${p.season}` : ''}
                      </div>
                      {p.suggestedBy ? (
                        <div className="text-muted-foreground text-xs">
                          {fill(T.products.suggestedBy, { who: p.suggestedBy })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{T.productTypes[p.productType]}</TableCell>
                    <TableCell>
                      {p.status === 'suggested' ? (
                        <div className="flex items-center gap-1">
                          <Badge variant="warning-light">{T.statuses.suggested}</Badge>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={T.products.approve}
                            onClick={() => go(() => reviewProductAction(entityRef, p.id, 'approved'))}
                          >
                            <Check />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={T.products.reject}
                            onClick={() => go(() => reviewProductAction(entityRef, p.id, 'rejected'))}
                          >
                            <X />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Badge variant={p.status === 'approved' ? 'success-light' : 'secondary'}>
                            {T.statuses[p.status]}
                          </Badge>
                          {/* recusa por engano volta pela aprovação; aprovado pode ser recusado */}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={p.status === 'rejected' ? T.products.approve : T.products.reject}
                            onClick={() =>
                              go(() =>
                                reviewProductAction(
                                  entityRef,
                                  p.id,
                                  p.status === 'rejected' ? 'approved' : 'rejected',
                                ),
                              )
                            }
                          >
                            {p.status === 'rejected' ? <Check /> : <X />}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.active}
                        disabled={pending || p.status === 'rejected'}
                        aria-label={T.products.active}
                        onCheckedChange={(v) => go(() => setProductActiveAction(entityRef, p.id, v === true))}
                      />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={pending || i <= 0}
                        aria-label={T.products.up}
                        onClick={() => go(() => moveProductAction(entityRef, p.id, 'up'))}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={pending || i < 0 || i >= ordered.length - 1}
                        aria-label={T.products.down}
                        onClick={() => go(() => moveProductAction(entityRef, p.id, 'down'))}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={T.products.edit}
                        onClick={() => setDialog(p)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground border-t p-4 text-sm">{T.products.empty}</p>
        )}
      </FramePanel>

      {dialog ? (
        <ProductDialog
          key={dialog === 'new' ? 'new' : dialog.id}
          entityRef={entityRef}
          store={store}
          current={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Frame>
  );
}

function ProductDialog({
  entityRef,
  store,
  current,
  onClose,
}: {
  entityRef: Ref;
  store: ShopStoreView;
  current: ShopProductView | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const T = t.shopping;
  const F = T.productForm;
  const { pending, go } = useAction();
  const [form, setForm] = useState({
    storeProductId: current?.storeProductId ?? '',
    productType: current?.productType ?? '',
    title: current?.title ?? '',
    season: current?.season ?? '',
    url: current?.url ?? '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const types = [...SHOP_PRODUCT_TYPES].sort((a, b) =>
    T.productTypes[a].localeCompare(T.productTypes[b], locale),
  );

  const submit = () =>
    go(
      () =>
        current
          ? updateProductAction(entityRef, current.id, form)
          : addProductAction(entityRef, { ...form, storeId: store.id }),
      F.saved,
      onClose,
    );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? F.titleEdit : fill(F.titleNew, { store: store.name })}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shop-product-id">{F.storeProductId}</FieldLabel>
            <Input
              id="shop-product-id"
              className="font-mono"
              value={form.storeProductId}
              maxLength={120}
              disabled={!!current}
              onChange={(e) => set('storeProductId')(e.target.value)}
            />
            <FieldDescription>{F.storeProductIdHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-product-title">{F.title}</FieldLabel>
            <Input
              id="shop-product-title"
              value={form.title}
              maxLength={160}
              onChange={(e) => set('title')(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="shop-product-type">{F.type}</FieldLabel>
              <Select value={form.productType} onValueChange={(v) => set('productType')(String(v ?? ''))}>
                <SelectTrigger id="shop-product-type">
                  <SelectValue placeholder={F.type} />
                </SelectTrigger>
                <SelectContent>
                  {types.map((k) => (
                    <SelectItem key={k} value={k}>
                      {T.productTypes[k as ShopProductType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-product-season">{F.season}</FieldLabel>
              <Input
                id="shop-product-season"
                value={form.season}
                maxLength={7}
                placeholder={T.entity.seasonHint}
                onChange={(e) => set('season')(e.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="shop-product-url">{F.url}</FieldLabel>
            <Input
              id="shop-product-url"
              type="url"
              placeholder={T.urlPlaceholder}
              value={form.url}
              maxLength={2000}
              onChange={(e) => set('url')(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {F.cancel}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            {F.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
