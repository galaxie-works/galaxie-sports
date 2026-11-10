'use client';

import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  checkFeedbackProgressNow,
  clearFeedbackToken,
  saveFeedbackGithub,
} from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSnapshot } from '@/lib/ops/types';

import { SourceBadge, useOpsAction } from './setting-row';

/**
 * Repo e token do "Sugerir ou reportar algo". O token é só-escrita: o campo começa sempre vazio, o servidor manda só o
 * estado (`snapshot.feedback`) e o valor digitado é limpo depois de salvo.
 */
export function FeedbackGithubCard({ snapshot, timeZone }: { snapshot: OpsSnapshot; timeZone: string }) {
  const { t } = useI18n();
  const T = t.ops.suggestions;
  const f = useFormatters(timeZone);
  const state = snapshot.feedback;
  const repoSetting = snapshot.settings.find((s) => s.key === 'FEEDBACK_GITHUB_REPO');
  const savedRepo = repoSetting?.source === 'db' ? (repoSetting.value ?? '') : '';
  const [repo, setRepo] = useState(savedRepo);
  const [token, setToken] = useState('');
  const { pending, run } = useOpsAction();

  const dirty = repo.trim() !== savedRepo || token.trim() !== '';
  const status = state.tokenUnreadable
    ? { text: T.status.unreadable, variant: 'destructive-light' as const }
    : state.tokenInPanel
      ? { text: T.status.panel, variant: 'primary-light' as const }
      : state.envTokenConfigured
        ? { text: T.status.env, variant: 'info-light' as const }
        : { text: T.status.none, variant: 'secondary' as const };

  const save = () =>
    run(
      () => saveFeedbackGithub({ repo, token }),
      T.saved,
      () => setToken(''),
    );

  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <form
          className="px-4 py-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !pending) save();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="feedback-repo">{T.repo}</FieldLabel>
              <Input
                id="feedback-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder={repoSetting?.envValue ?? T.repoPlaceholder}
                disabled={pending}
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono text-xs"
              />
              <FieldDescription className="flex flex-wrap items-center gap-1.5">
                {repoSetting ? <SourceBadge source={repoSetting.source} /> : null}
                {T.repoHint}
              </FieldDescription>
            </Field>
            <Field>
              <div className="flex flex-wrap items-center gap-2">
                <FieldLabel htmlFor="feedback-token">{T.token}</FieldLabel>
                <Badge variant={status.variant}>{status.text}</Badge>
              </div>
              <Input
                id="feedback-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={T.tokenPlaceholder}
                disabled={pending || !state.kekConfigured}
                autoComplete="new-password"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <FieldDescription>
                {state.kekConfigured ? T.tokenHint : T.noKek}
                {state.tokenChangedBy && state.tokenChangedAt
                  ? ` ${fill(T.changed, {
                      by: state.tokenChangedBy,
                      when: f.relative(state.tokenChangedAt, Date.parse(snapshot.generatedAt)),
                    })}`
                  : ''}
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {state.tokenInPanel ? (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button type="button" variant="ghost" size="sm" disabled={pending} />}
                  >
                    <Trash2 />
                    {T.remove}
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{T.removeTitle}</AlertDialogTitle>
                      <AlertDialogDescription>{T.removeBody}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t.ops.actions.cancel}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => run(() => clearFeedbackToken(), T.removed)}>
                        {T.remove}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
              <Button type="submit" size="sm" disabled={pending || !dirty}>
                {pending ? <Spinner /> : <Save />}
                {T.save}
              </Button>
            </div>
          </FieldGroup>
        </form>
        <ProgressRow snapshot={snapshot} timeZone={timeZone} />
      </FramePanel>
    </Frame>
  );
}

/** Última conferência do andamento (avisos na caixa de entrada) e o "Verificar agora". */
function ProgressRow({ snapshot, timeZone }: { snapshot: OpsSnapshot; timeZone: string }) {
  const T = useI18n().t.ops.suggestions.progress;
  const f = useFormatters(timeZone);
  const { pending, run } = useOpsAction();
  const p = snapshot.feedback.progress;
  const now = Date.parse(snapshot.generatedAt);
  const failedLast = p?.error && p.finishedAt && (!p.okAt || p.finishedAt > p.okAt);
  const text = !p
    ? T.never
    : failedLast
      ? fill(T.error, { when: f.relative(p.finishedAt!, now) })
      : p.okAt
        ? fill(T.last, { when: f.relative(p.okAt, now), issues: p.issues, notices: p.notices })
        : T.never;
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-4">
      <p className="text-sm font-medium">{T.title}</p>
      <p className="text-muted-foreground text-sm">{T.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm ${failedLast ? 'text-destructive' : ''}`}>{text}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => checkFeedbackProgressNow(), T.done)}
        >
          {pending ? <Spinner /> : <RefreshCw />}
          {T.run}
        </Button>
      </div>
    </div>
  );
}
