'use client';

import { Pencil, PlugZap, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveStoreAction } from '@/app/[locale]/(app)/ajustes/shopping/actions';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { SHOP_NETWORKS, type ShopNetwork } from '@/lib/shop/catalog-input';
import type { ShopEntitySummary, ShopStoreView } from '@/lib/shop/catalog';

/**
 * Ajustes → Engajamento → Shopping (#914): as lojas da Galaxie e a lista de entidades (as já curadas ou o resultado
 * da busca), que leva à curadoria de cada uma.
 */
export function ShoppingCatalog({
  stores,
  entities,
  query,
  searching,
}: {
  stores: ShopStoreView[];
  entities: ShopEntitySummary[];
  query: string;
  searching: boolean;
}) {
  const { t, locale } = useI18n();
  const T = t.shopping;
  const [editing, setEditing] = useState<ShopStoreView | 'new' | null>(null);
  const router = useRouter();
  const [q, setQ] = useState(query);
  const sortedNetworks = [...SHOP_NETWORKS].sort((a, b) =>
    T.networks[a].localeCompare(T.networks[b], locale),
  );

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.stores.title}</FrameTitle>
              <FrameDescription>{T.stores.description}</FrameDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/ajustes/shopping/conectores" />}
              >
                <PlugZap />
                {T.connectors.link}
              </Button>
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus />
                {T.stores.add}
              </Button>
            </div>
          </FrameHeader>
          {stores.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.stores.name}</TableHead>
                  <TableHead>{T.stores.country}</TableHead>
                  <TableHead>{T.stores.network}</TableHead>
                  <TableHead>{T.stores.products}</TableHead>
                  <TableHead>{T.stores.status}</TableHead>
                  <TableHead className="sr-only">{T.stores.edit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-muted-foreground font-mono text-xs">{s.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.country}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{T.networks[s.network]}</TableCell>
                    <TableCell className="text-xs">{s.products}</TableCell>
                    <TableCell>
                      <Badge variant={s.active ? 'success-light' : 'secondary'}>
                        {s.active ? T.stores.on : T.stores.off}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(s)}
                        aria-label={T.stores.edit}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{T.stores.empty}</p>
          )}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.entities.title}</FrameTitle>
              <FrameDescription>{T.entities.description}</FrameDescription>
            </div>
            <form
              className="flex max-w-md items-center gap-2"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const v = q.trim();
                router.push(v ? `/ajustes/shopping?q=${encodeURIComponent(v)}` : '/ajustes/shopping');
              }}
            >
              <Input
                value={q}
                maxLength={80}
                onChange={(e) => setQ(e.target.value)}
                placeholder={T.entities.search}
                aria-label={T.entities.search}
              />
              <Button type="submit" variant="outline">
                <Search />
                {T.entities.searchButton}
              </Button>
            </form>
            <p className="text-muted-foreground text-xs font-medium">
              {searching ? T.entities.results : T.entities.curated}
            </p>
          </FrameHeader>
          {entities.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.entities.name}</TableHead>
                  <TableHead>{T.entities.type}</TableHead>
                  <TableHead>{T.entities.approved}</TableHead>
                  <TableHead>{T.entities.suggested}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entities.map((e) => (
                  <TableRow key={`${e.kind}:${e.id}`}>
                    <TableCell>
                      <Link
                        className="font-medium hover:underline"
                        href={`/ajustes/shopping/${e.kind}/${e.id}`}
                      >
                        {e.name}
                      </Link>
                      {e.countryCode ? (
                        <span className="text-muted-foreground ml-2 text-xs">{e.countryCode}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {T.subtypes[e.subtype as keyof typeof T.subtypes] ?? e.subtype}
                      {e.sport ? <span className="text-muted-foreground"> · {e.sport}</span> : null}
                    </TableCell>
                    <TableCell className="text-xs">{e.approved}</TableCell>
                    <TableCell>
                      {e.suggested ? <Badge variant="warning-light">{e.suggested}</Badge> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">
              {searching
                ? fill(T.entities.noResults, { query })
                : query.trim()
                  ? T.entities.minChars
                  : T.entities.empty}
            </p>
          )}
        </FramePanel>
      </Frame>

      {editing ? (
        <StoreDialog
          key={editing === 'new' ? 'new' : editing.id}
          current={editing === 'new' ? null : editing}
          networks={sortedNetworks}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function StoreDialog({
  current,
  networks,
  onClose,
}: {
  current: ShopStoreView | null;
  networks: ShopNetwork[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.shopping;
  const F = T.storeForm;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    id: current?.id ?? '',
    name: current?.name ?? '',
    country: current?.country ?? '',
    network: current?.network ?? '',
    homeUrl: current?.homeUrl ?? '',
    position: String(current?.position ?? 0),
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () =>
    start(async () => {
      const r = await saveStoreAction(form, !current);
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      toast.success(F.saved);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? fill(F.titleEdit, { name: current.name }) : F.titleNew}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shop-store-id">{F.id}</FieldLabel>
            <Input
              id="shop-store-id"
              className="font-mono"
              value={form.id}
              maxLength={40}
              disabled={!!current}
              onChange={(e) => set('id')(e.target.value)}
            />
            <FieldDescription>{F.idHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-store-name">{F.name}</FieldLabel>
            <Input
              id="shop-store-name"
              value={form.name}
              maxLength={60}
              onChange={(e) => set('name')(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="shop-store-country">{F.country}</FieldLabel>
              <Input
                id="shop-store-country"
                className="uppercase"
                value={form.country}
                maxLength={2}
                onChange={(e) => set('country')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-store-position">{F.position}</FieldLabel>
              <Input
                id="shop-store-position"
                type="number"
                min={0}
                max={999}
                value={form.position}
                onChange={(e) => set('position')(e.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="shop-store-network">{F.network}</FieldLabel>
            <Select value={form.network} onValueChange={(v) => set('network')(String(v ?? ''))}>
              <SelectTrigger id="shop-store-network">
                <SelectValue placeholder={F.network} />
              </SelectTrigger>
              <SelectContent>
                {networks.map((n) => (
                  <SelectItem key={n} value={n}>
                    {T.networks[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-store-home">{F.homeUrl}</FieldLabel>
            <Input
              id="shop-store-home"
              type="url"
              value={form.homeUrl}
              maxLength={2000}
              placeholder={T.urlPlaceholder}
              onChange={(e) => set('homeUrl')(e.target.value)}
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
