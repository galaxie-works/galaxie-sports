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
  RotateCcw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { checkAiCreditNow } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { resealSecrets } from '@/app/[locale]/(app)/ajustes/operacao/secret-actions';
import { settingText } from '@/components/ops/format';
import { useOpsAction } from '@/components/ops/use-ops-action';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting, ServiceStatus } from '@/lib/ops/types';

import {
  aiProviderKey,
  credentialGroup,
  groupCredentials,
  historyHref,
  secretSource,
  type SecretSource,
} from './logic';
import { SecretDialog } from './secret-dialog';
import { StatusList, type StatusItem } from './status-list';

/** Ícone de cada credencial (as que não estão aqui usam o da seção). */
const KEY_ICONS: Readonly<Record<string, ReactNode>> = {
  APISPORTS_KEY: 'as',
  YOUTUBE_API_KEY: 'YT',
  OPENAI_API_KEY: 'AI',
  ANTHROPIC_API_KEY: 'A\\',
  GEMINI_API_KEY: 'G',
  DEEPSEEK_API_KEY: 'DS',
  COSMOS_OPENAI_API_KEY: 'AI',
  COSMOS_ANTHROPIC_API_KEY: 'A\\',
  COSMOS_GEMINI_API_KEY: 'G',
  COSMOS_DEEPSEEK_API_KEY: 'DS',
  SETTINGS_KEK: <Lock />,
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
 * infraestrutura, pagamentos). O servidor manda só de onde a chave vem (painel, .env) e, no máximo, os 4 últimos
 * caracteres da chave do painel: o valor nunca chega ao navegador. As chaves que o painel troca (#1087) têm "Trocar"
 * (diálogo com teste antes de salvar) e "Voltar ao .env"; as que ficam só no .env levam o selo "só no servidor".
 * "Testar" (a checagem de crédito que já existe, `checkAiCreditNow`) só na chave do provedor de IA ativo.
 */
export function CredentialsList({
  settings,
  aiProvider,
  title,
  description,
}: {
  settings: readonly OpsSetting[];
  /** Provedor de IA ativo (valor efetivo de AI_PROVIDER): só a chave dele tem "Testar". */
  aiProvider?: string | null;
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const B = T.blocks.status;
  const router = useRouter();
  const { pending, run } = useOpsAction();
  const [target, setTarget] = useState<{ setting: OpsSetting; step: 'edit' | 'reset' } | null>(null);
  const secrets = settings.filter((s) => settingDef(s.key)?.type === 'secret');
  if (!secrets.length) return null;

  const labelled = secrets.map((s) => ({ ...s, label: settingText(T, settingDef(s.key)!).label }));
  const sections = groupCredentials(labelled).map(({ group, items }) => ({
    id: group,
    title: B.groups[group].title,
    description: B.groups[group].description,
    items: items.map((s): StatusItem => {
      const def = settingDef(s.key)!;
      const editable = s.secret?.editable ?? false;
      const source = secretSource(s);
      return {
        id: s.key,
        icon: KEY_ICONS[s.key] ?? GROUP_ICONS[credentialGroup(s.key)],
        name: s.label,
        purpose: editable ? undefined : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{B.serverOnly}</Badge>
            {T.secretKeys.serverOnly}
          </span>
        ),
        meta: `${s.key} · ${def.services.map((x) => T.services[x]).join(', ')}`,
        tone: SOURCE_TONE[source],
        statusLabel:
          source === 'panel'
            ? B.inPanel
            : source === 'env'
              ? editable
                ? B.inEnv
                : B.configured
              : source === 'unreadable'
                ? B.unreadable
                : B.missing,
        hint: source === 'panel' ? (s.secret?.hint ?? null) : null,
        menu: [
          ...(editable
            ? [
                {
                  label: B.change,
                  icon: <KeyRound />,
                  onSelect: () => setTarget({ setting: s, step: 'edit' }),
                },
              ]
            : []),
          ...(editable && s.secret?.inPanel
            ? [
                {
                  label: B.resetToEnv,
                  icon: <RotateCcw />,
                  onSelect: () => setTarget({ setting: s, step: 'reset' }),
                },
              ]
            : []),
          ...(s.key === aiProviderKey(aiProvider)
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
  const reseal = secrets.some((s) => s.secret?.needsReseal);

  return (
    <>
      <StatusList
        id="credenciais"
        title={title ?? B.credentialsTitle}
        description={description ?? B.credentialsDescription}
        action={
          reseal ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              title={B.resealHint}
              onClick={() => run(() => resealSecrets(), B.reseal)}
            >
              <ShieldCheck />
              {B.reseal}
            </Button>
          ) : undefined
        }
        sections={sections}
      />
      <SecretDialog
        key={target ? `${target.setting.key}:${target.step}` : 'fechado'}
        setting={target?.setting ?? null}
        initialStep={target?.step ?? 'edit'}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

/** Tom da linha: a chave que não abre aparece como aviso (vale o .env). */
const SOURCE_TONE = {
  panel: 'ok',
  env: 'ok',
  unreadable: 'warning',
  none: 'missing',
} as const satisfies Record<SecretSource, StatusItem['tone']>;

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
