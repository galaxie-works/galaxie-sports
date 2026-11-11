'use client';

import { settingDef, type RuntimeService } from '@galaxie/runtime-config';
import {
  Activity,
  Bot,
  Cpu,
  CreditCard,
  Database,
  Globe,
  HardDrive,
  History,
  KeyRound,
  Lock,
  Mail,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { checkAiCreditNow } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { settingText } from '@/components/ops/format';
import { useOpsAction } from '@/components/ops/use-ops-action';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting, ServiceStatus } from '@/lib/ops/types';

import { credentialGroup, groupCredentials, historyHref } from './logic';
import { StatusList, type StatusItem } from './status-list';

/** Ícone de cada credencial (as que não estão aqui usam o da seção). */
const KEY_ICONS: Readonly<Record<string, ReactNode>> = {
  APISPORTS_KEY: 'as',
  YOUTUBE_API_KEY: 'YT',
  OPENAI_API_KEY: 'AI',
  ANTHROPIC_API_KEY: 'A\\',
  GEMINI_API_KEY: 'G',
  STRIPE_SECRET_KEY: 'S',
  STRIPE_WEBHOOK_SECRET: 'S',
  S3_ACCESS_KEY: <HardDrive />,
  S3_SECRET_KEY: <HardDrive />,
  SMTP_HOST: <Mail />,
  SMTP_USER: <Mail />,
  SMTP_PASSWORD: <Mail />,
  METRICS_TOKEN: <Activity />,
  WEBHOOK_SIGNING_SECRET: <ShieldCheck />,
  BETTER_AUTH_SECRET: <Lock />,
  ADMIN_KEY_HASHES: <Lock />,
  GALAXIE_DEMO_KEY: <KeyRound />,
  QUALITY_API_KEY: <KeyRound />,
  FEEDBACK_GITHUB_TOKEN: 'GH',
};

const GROUP_ICONS = {
  sports: <Database />,
  ai: <Bot />,
  infra: <Server />,
  payments: <CreditCard />,
} as const;

/**
 * Credenciais no padrão `settings-4` (#1076): as chaves marcadas como segredo, por seção (dados esportivos, IA,
 * infraestrutura, pagamentos). O servidor manda só `configured`: o valor nunca chega ao navegador. "Trocar" explica
 * onde trocar (o .env da VPS); "Testar" só nas chaves de IA, pela checagem da conta que já existe.
 */
export function CredentialsList({
  settings,
  title,
  description,
}: {
  settings: readonly OpsSetting[];
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const B = T.blocks.status;
  const router = useRouter();
  const { pending, run } = useOpsAction();
  const [changing, setChanging] = useState<OpsSetting | null>(null);
  const secrets = settings.filter((s) => settingDef(s.key)?.type === 'secret');
  if (!secrets.length) return null;

  const labelled = secrets.map((s) => ({ ...s, label: settingText(T, settingDef(s.key)!).label }));
  const sections = groupCredentials(labelled).map(({ group, items }) => ({
    id: group,
    title: B.groups[group].title,
    description: B.groups[group].description,
    items: items.map((s): StatusItem => {
      const def = settingDef(s.key)!;
      return {
        id: s.key,
        icon: KEY_ICONS[s.key] ?? GROUP_ICONS[credentialGroup(s.key)],
        name: s.label,
        meta: `${s.key} · ${def.services.map((x) => T.services[x]).join(', ')}`,
        tone: s.configured ? 'ok' : 'missing',
        statusLabel: s.configured ? B.configured : B.missing,
        menu: [
          { label: B.change, icon: <KeyRound />, onSelect: () => setChanging(s) },
          ...(credentialGroup(s.key) === 'ai'
            ? [
                {
                  label: B.test,
                  icon: <RefreshCw />,
                  disabled: pending,
                  onSelect: () => run(() => checkAiCreditNow(), T.feedback.queued),
                },
              ]
            : []),
          { label: T.blocks.viewHistory, icon: <History />, onSelect: () => router.push(historyHref(s.key)) },
        ],
      };
    }),
  }));

  const changingDef = changing ? settingDef(changing.key) : null;
  return (
    <>
      <StatusList
        id="credenciais"
        title={title ?? B.credentialsTitle}
        description={description ?? B.credentialsDescription}
        sections={sections}
      />
      <Dialog open={changing !== null} onOpenChange={(open) => !open && setChanging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {fill(B.changeTitle, { name: changing ? settingText(T, settingDef(changing.key)!).label : '' })}
            </DialogTitle>
            <DialogDescription>
              {fill(B.changeBody, {
                keys: changing?.key ?? '',
                services: changingDef ? changingDef.services.map((x) => T.services[x]).join(', ') : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{B.close}</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const SERVICE_ICONS: Readonly<Record<RuntimeService, ReactNode>> = {
  ingestor: <Database />,
  agents: <Bot />,
  live: <Radio />,
  api: <Cpu />,
  demo: <Globe />,
};

/**
 * Status dos serviços no mesmo padrão (#1076): uma linha por contêiner com o último relato e, no ao vivo, a líder e o
 * último tick.
 */
export function ServicesStatusList({
  services,
  timeZone,
  now,
}: {
  services: readonly ServiceStatus[];
  timeZone: string;
  now: string;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const B = T.blocks.status;
  const f = useFormatters(timeZone);
  const at = Date.parse(now);
  const items = services.map((s): StatusItem => {
    const reported = s.reportedAt
      ? fill(s.service === 'api' ? T.status.startedAt : T.status.reported, {
          when: f.relative(s.reportedAt, at),
        })
      : T.status.never;
    const live = s.live
      ? [
          s.live.leader
            ? fill(T.status.liveLeader, {
                instance: s.live.leader.slice(0, 12),
                epoch: String(s.live.epoch ?? '—'),
                when: s.live.leaderSince ? f.relative(s.live.leaderSince, at) : '—',
              })
            : T.status.liveNoLeader,
          s.live.lastTickAt
            ? fill(T.status.liveLastTick, { when: f.relative(s.live.lastTickAt, at) })
            : T.status.liveNoTick,
        ].join(' · ')
      : null;
    return {
      id: `servico-${s.service}`,
      icon: SERVICE_ICONS[s.service],
      name: T.services[s.service],
      purpose: live ? `${reported} · ${live}` : reported,
      tone: s.alive ? 'ok' : 'offline',
      statusLabel: s.alive ? T.status.alive : T.status.offline,
    };
  });
  return (
    <StatusList
      id="status-dos-servicos"
      title={B.servicesTitle}
      description={B.servicesDescription}
      sections={[{ id: 'services', title: T.status.services, items }]}
    />
  );
}
