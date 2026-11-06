'use client';

import { KeyRound, LockKeyhole } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { toast } from 'sonner';

import {
  sealSecretsAction,
  setDeliveryAction,
  setRejectPlaintextAction,
  type WebhookControlResult,
} from '@/app/[locale]/(app)/ajustes/webhooks/actions';
import { formatDuration } from '@/components/ops/format';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface WebhooksOverviewView {
  endpoints: number;
  activeEndpoints: number;
  plaintextSecrets: number;
  pending: number;
  dead: number;
  overdueSeconds: number;
  controls: { deliveryEnabled: boolean; rejectPlaintext: boolean };
  worker: {
    reportedAt: string | null;
    alive: boolean;
    kekConfigured: boolean | null;
    rejectPlaintext: boolean | null;
    deliveryEnabled: boolean | null;
  };
}

type Tone = 'success-light' | 'destructive-light' | 'warning-light' | 'secondary';

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string | null }) {
  return (
    <div className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-col items-start gap-0.5 sm:items-end">
        <div className="flex items-center gap-2 text-sm">{children}</div>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </div>
    </div>
  );
}

function State({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge variant={tone}>{children}</Badge>;
}

/**
 * Ajustes → Webhooks: o retrato do que está ligado (chave de cifra no worker e no painel, worker no ar, fila e
 * segredos sem cifra) e os controles que valem para todos os clientes. A página se atualiza a cada 15 s para
 * mostrar quando o worker aplicou a mudança.
 */
export function WebhooksControl({
  overview: o,
  panelKek,
  timeZone,
}: {
  overview: WebhooksOverviewView;
  panelKek: boolean;
  timeZone: string;
}) {
  const { t, locale } = useI18n();
  const f = useFormatters(timeZone);
  const T = t.webhooksAdmin;
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [router]);

  const act = (call: () => Promise<WebhookControlResult>, done: (r: WebhookControlResult) => string) =>
    start(async () => {
      const r = await call();
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      (r.failed ? toast.warning : toast.success)(done(r));
      router.refresh();
    });

  const kekState = (v: boolean | null) =>
    v === null ? (
      <State tone="secondary">{T.status.unknown}</State>
    ) : v ? (
      <State tone="success-light">{T.status.yes}</State>
    ) : (
      <State tone="destructive-light">{T.status.no}</State>
    );

  const kekMissing = o.worker.kekConfigured === false || !panelKek;
  const workerLags = (applied: boolean | null, wanted: boolean) =>
    o.worker.alive && applied !== null && applied !== wanted ? T.controls.pending : null;
  const rejectBlocked = !o.controls.rejectPlaintext && o.plaintextSecrets > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{T.status.title}</FrameTitle>
            <FrameDescription>{T.status.description}</FrameDescription>
          </FrameHeader>
          <Row label={T.status.workerKek}>{kekState(o.worker.kekConfigured)}</Row>
          <Row label={T.status.panelKek}>{kekState(panelKek)}</Row>
          <Row
            label={T.status.worker}
            hint={
              o.worker.reportedAt
                ? fill(T.status.lastReport, { when: f.relative(o.worker.reportedAt) })
                : T.status.neverReported
            }
          >
            {o.worker.alive ? (
              <State tone="success-light">{T.status.alive}</State>
            ) : (
              <State tone="destructive-light">{T.status.down}</State>
            )}
          </Row>
          <Row label={T.status.endpoints}>
            {fill(T.status.endpointsValue, { n: o.endpoints, active: o.activeEndpoints })}
          </Row>
          <Row
            label={T.status.queue}
            hint={
              o.overdueSeconds > 0
                ? fill(T.status.overdue, { duration: formatDuration(locale, o.overdueSeconds * 1000) })
                : null
            }
          >
            {fill(T.status.queueValue, { pending: f.number(o.pending), dead: f.number(o.dead) })}
          </Row>
          <Row label={T.status.plaintext}>
            {o.plaintextSecrets > 0 ? (
              <State tone="warning-light">{f.number(o.plaintextSecrets)}</State>
            ) : (
              <State tone="success-light">{T.status.noneLeft}</State>
            )}
          </Row>
          {kekMissing ? (
            <div className="p-4">
              <Alert variant="info">
                <KeyRound />
                <AlertDescription>{T.status.kekHint}</AlertDescription>
              </Alert>
            </div>
          ) : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{T.controls.title}</FrameTitle>
            <FrameDescription>{T.controls.description}</FrameDescription>
          </FrameHeader>

          <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="wh-delivery" className="text-sm font-medium">
                {T.controls.delivery}
              </label>
              <span className="text-muted-foreground text-xs">{T.controls.deliveryHint}</span>
              {workerLags(o.worker.deliveryEnabled, o.controls.deliveryEnabled) ? (
                <span className="text-warning-foreground text-xs">{T.controls.pending}</span>
              ) : null}
            </div>
            <Switch
              id="wh-delivery"
              aria-label={T.controls.delivery}
              checked={o.controls.deliveryEnabled}
              disabled={pending}
              onCheckedChange={(on) =>
                act(
                  () => setDeliveryAction(on),
                  () => (on ? T.toasts.resumed : T.toasts.paused),
                )
              }
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="wh-reject" className="text-sm font-medium">
                {T.controls.reject}
              </label>
              <span className="text-muted-foreground text-xs">{T.controls.rejectHint}</span>
              {rejectBlocked ? (
                <span className="text-warning-foreground text-xs">
                  {fill(T.controls.rejectBlocked, { n: o.plaintextSecrets })}
                </span>
              ) : workerLags(o.worker.rejectPlaintext, o.controls.rejectPlaintext) ? (
                <span className="text-warning-foreground text-xs">{T.controls.pending}</span>
              ) : null}
            </div>
            <Switch
              id="wh-reject"
              aria-label={T.controls.reject}
              checked={o.controls.rejectPlaintext}
              disabled={pending || rejectBlocked}
              onCheckedChange={(on) =>
                act(
                  () => setRejectPlaintextAction(on),
                  () => (on ? T.toasts.rejectOn : T.toasts.rejectOff),
                )
              }
            />
          </div>

          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{T.controls.seal}</span>
              <span className="text-muted-foreground text-xs">
                {panelKek ? T.controls.sealHint : T.controls.sealNoKek}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={pending || !panelKek}
              onClick={() =>
                act(sealSecretsAction, (r) =>
                  r.failed
                    ? fill(T.toasts.sealFailed, { n: r.failed })
                    : r.sealed
                      ? fill(T.toasts.sealed, { n: r.sealed })
                      : T.toasts.sealedNone,
                )
              }
            >
              {pending ? <Spinner /> : <LockKeyhole />}
              {T.controls.seal}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    </div>
  );
}
