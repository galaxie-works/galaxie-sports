'use client';

import { ExternalLink, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setShowOtherOperators } from '@/app/[locale]/(app)/cliente/grade/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { plural } from '@/lib/i18n/text';
import type { ItemView, LibraryEntry, LineupView, PlanView, RequestView } from '@/lib/lineup/types';

import { ItemLogo, RequestBadge, SourceLine, useFieldText } from './parts';
import { RequestAddDialog, RequestReviewDialog } from './request-dialog';

interface Props {
  lineup: LineupView | null;
  showOtherOperators: boolean;
  pending: number;
  requests: RequestView[];
  /** Canais e streamings do país (pedido de inclusão num plano). */
  library: LibraryEntry[];
  timeZone: string;
}

/** Canal ou streaming dentro do plano: logo, nome, acesso, fonte e o pedido de revisão. */
function OfferRow({ item, timeZone }: { item: ItemView; timeZone: string }) {
  const { t } = useI18n();
  const access = item.fields.access as 'included' | 'addon' | null | undefined;
  return (
    <li className="flex items-center gap-3 rounded-lg border p-2">
      <ItemLogo name={item.name} url={item.logoUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {access ? t.lineup.access[access] : ''}
        </span>
        <SourceLine sources={item.sources} timeZone={timeZone} />
      </div>
      <RequestReviewDialog item={item} compact />
    </li>
  );
}

function PlanCard({
  plan,
  library,
  timeZone,
}: {
  plan: PlanView;
  library: LibraryEntry[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const P = t.lineup.portal;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plan.name}
          {plan.fields.priceText ? (
            <Badge variant="outline" className="font-normal">
              {plan.fields.priceText}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          <SourceLine sources={plan.sources} timeZone={timeZone} />
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-1">
          <RequestAddDialog plan={plan} library={library} />
          <RequestReviewDialog item={plan} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{P.channels}</h3>
          {plan.channels.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plan.channels.map((c) => (
                <OfferRow key={c.id} item={c} timeZone={timeZone} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{P.noChannels}</p>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{P.services}</h3>
          {plan.services.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plan.services.map((s) => (
                <OfferRow key={s.id} item={s} timeZone={timeZone} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{P.noServices}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

/** Interruptor "Mostrar outras operadoras nas respostas da API" (desligado por padrão). */
function ShowOthersSwitch({ value }: { value: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const P = t.lineup.portal;
  const [checked, setChecked] = useState(value);
  const [pending, startTransition] = useTransition();
  return (
    <Field orientation="horizontal">
      <Switch
        id="lineup-show-others"
        checked={checked}
        disabled={pending}
        onCheckedChange={(next) => {
          setChecked(next);
          startTransition(async () => {
            const res = await setShowOtherOperators(next);
            if (!res.ok) {
              setChecked(!next);
              toast.error(res.error ?? t.lineup.errors.generic);
              return;
            }
            toast.success(P.saved);
            router.refresh();
          });
        }}
      />
      <FieldContent>
        <FieldLabel htmlFor="lineup-show-others">{P.showOthers}</FieldLabel>
        <FieldDescription>{checked ? P.showOthersOn : P.showOthersOff}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

function RequestsTable({ requests, timeZone }: { requests: RequestView[]; timeZone: string }) {
  const { t } = useI18n();
  const P = t.lineup.portal;
  const f = useFormatters(timeZone);
  const text = useFieldText();
  if (!requests.length) return <p className="text-muted-foreground text-sm">{P.noRequests}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{P.requestItem}</TableHead>
            <TableHead>{P.requestMessage}</TableHead>
            <TableHead>{P.requestStatus}</TableHead>
            <TableHead>{P.requestDate}</TableHead>
            <TableHead>{P.requestAnswer}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-56">
                <span className="block truncate font-medium">{r.targetName ?? P.removed}</span>
                <span className="text-muted-foreground text-xs">{t.lineup.types[r.targetType]}</span>
              </TableCell>
              <TableCell className="max-w-80 text-sm whitespace-normal">
                {r.message}
                {r.proposed ? (
                  <span className="text-muted-foreground mt-1 block text-xs">{text.summary(r.proposed)}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <RequestBadge status={r.status} />
              </TableCell>
              <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                {f.relative(r.createdAt)}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-64 text-xs whitespace-normal">
                {r.resolutionNote ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Portal "Grade e ofertas": a grade da operadora do tenant como a API publica e os pedidos de revisão. */
export function LineupPortal({ lineup, showOtherOperators, pending, requests, library, timeZone }: Props) {
  const { locale, t } = useI18n();
  const P = t.lineup.portal;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-3xl text-sm">{P.description}</p>
      {lineup ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              <ItemLogo name={lineup.platform.name} url={lineup.platform.logoUrl} className="size-10" />
              <span className="flex flex-col">
                <span className="text-lg">{lineup.platform.name}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {[
                    (t.nav.countries as Record<string, string>)[lineup.platform.country] ??
                      lineup.platform.country,
                    t.lineup.kinds[lineup.platform.kind],
                    plural(locale, lineup.plans.length, P.plans),
                  ].join(' · ')}
                </span>
              </span>
            </CardTitle>
            <CardDescription className="flex flex-col gap-1">
              <SourceLine sources={lineup.platform.sources} timeZone={timeZone} />
              {lineup.platform.fields.website ? (
                <a
                  href={lineup.platform.fields.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-foreground inline-flex w-fit items-center gap-1 text-xs underline-offset-4 hover:underline"
                >
                  {P.website}
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </CardDescription>
            <CardAction>
              <RequestReviewDialog item={lineup.platform} />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert variant="info">
              <Info />
              <AlertDescription>
                {P.published}
                {pending ? ` ${plural(locale, pending, P.pending)}` : ''}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="warning">
          <Info />
          <AlertDescription>{P.unpublished}</AlertDescription>
        </Alert>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>{P.apiTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ShowOthersSwitch value={showOtherOperators} />
        </CardContent>
      </Card>

      {lineup?.plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} library={library} timeZone={timeZone} />
      ))}
      {lineup && !lineup.plans.length ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">{P.noPlans}</p>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>{P.requestsTitle}</CardTitle>
          <CardDescription>{P.requestsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <RequestsTable requests={requests} timeZone={timeZone} />
        </CardContent>
      </Card>
    </div>
  );
}
