'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';

import { FeedbackGithubCard } from '@/components/ops/feedback-github-card';
import { Button } from '@/components/ui/button';
import { Item } from '@/components/ui/item';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSnapshot } from '@/lib/ops/types';

import { IntegrationCard } from './integration-card';
import { CREDENTIALS_HREF, githubIntegrationState } from './logic';
import { SettingRow } from './setting-row';

/**
 * GitHub do "Sugerir ou reportar algo" no padrão `settings-6` (#1077): o estado da ligação com a repo de sugestões;
 * conectado, abre o liga/desliga do botão (FEEDBACK_ENABLED). Repo e token continuam no formulário de sempre (o token
 * é só-escrita e fica cifrado no painel); sem a chave do contêiner para cifrar, o cartão leva a Credenciais.
 */
export function GithubIntegration({ snapshot, timeZone }: { snapshot: OpsSnapshot; timeZone: string }) {
  const { t } = useI18n();
  const B = t.ops.blocks.integrations;
  const repo = snapshot.settings.find((s) => s.key === 'FEEDBACK_GITHUB_REPO')?.value ?? null;
  const enabled = snapshot.settings.find((s) => s.key === 'FEEDBACK_ENABLED');
  const state = githubIntegrationState(repo, snapshot.feedback);
  const noKey = !snapshot.feedback.kekConfigured && !snapshot.feedback.envTokenConfigured;
  return (
    <IntegrationCard
      id="integracao-github"
      icon="GH"
      name={B.github.name}
      state={state}
      description={
        snapshot.feedback.tokenUnreadable
          ? B.github.unreadable
          : repo
            ? fill(B.github.description, { repo })
            : B.github.noRepo
      }
      action={
        noKey ? (
          <Button variant="outline" size="sm" render={<Link href={CREDENTIALS_HREF} />} nativeButton={false}>
            <KeyRound />
            {B.openCredentials}
          </Button>
        ) : null
      }
      setup={<FeedbackGithubCard key={repo ?? ''} snapshot={snapshot} timeZone={timeZone} embedded />}
    >
      {enabled ? (
        <Item variant="muted">
          <SettingRow
            key={`${enabled.key}:${enabled.source}:${enabled.value}`}
            setting={enabled}
            timeZone={timeZone}
            now={snapshot.generatedAt}
            variant="nested"
          />
        </Item>
      ) : null}
    </IntegrationCard>
  );
}
