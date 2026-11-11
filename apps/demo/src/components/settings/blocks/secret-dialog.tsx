'use client';

import { settingApplyGroups, settingDef } from '@galaxie/runtime-config';
import { CircleAlert, FlaskConical, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  resetSecret,
  saveSecret,
  testSecret,
  type SecretActionResult,
} from '@/app/[locale]/(app)/ajustes/operacao/secret-actions';
import { settingText } from '@/components/ops/format';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';

import { secretSource } from './logic';

/** Etapa do diálogo: digitando, confirmando a troca ou confirmando a volta ao .env. */
type Step = 'edit' | 'confirm' | 'reset';

/**
 * "Trocar" de uma chave secreta (#1087): campo de senha (o valor atual nunca vem do servidor; no máximo "termina em
 * abcd"), "Testar antes de salvar" no provedor com a chave digitada, "Salvar" com confirmação e "Voltar ao .env".
 * Chave só do .env mostra só a explicação. A chave digitada some do estado ao fechar.
 */
export function SecretDialog({
  setting,
  initialStep = 'edit',
  onClose,
}: {
  /** A chave aberta; `null` fecha o diálogo. */
  setting: OpsSetting | null;
  /** `reset`: abre já pedindo a confirmação do "Voltar ao .env" (item do menu ⋮). */
  initialStep?: 'edit' | 'reset';
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const S = T.secretKeys;
  const B = T.blocks.status;
  const router = useRouter();
  const [value, setValue] = useState('');
  const [step, setStep] = useState<Step>(initialStep);
  const [tested, setTested] = useState<'ok' | null>(null);
  const [pending, startTransition] = useTransition();

  const def = setting ? settingDef(setting.key) : undefined;
  const state = setting?.secret;
  const close = () => {
    setValue('');
    setStep('edit');
    setTested(null);
    onClose();
  };
  const services = (list: readonly string[]) =>
    list.map((s) => T.services[s as keyof typeof T.services] ?? s).join(', ');

  const run = (fn: () => Promise<SecretActionResult>, done: string, closeAfter: boolean) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setStep('edit');
        return void toast.error(res.error ?? T.feedback.failed);
      }
      if (res.test === 'ok' && !closeAfter) {
        setTested('ok');
        return void toast.success(S.testOk);
      }
      if (res.warning) toast.warning(res.warning);
      else toast.success(done);
      close();
      router.refresh();
    });

  const editable = Boolean(state?.editable);
  const source = setting ? secretSource(setting) : 'none';
  const sourceText =
    source === 'panel'
      ? state?.hint
        ? fill(S.sourcePanelHint, { hint: state.hint })
        : S.sourcePanel
      : source === 'env'
        ? S.sourceEnv
        : source === 'unreadable'
          ? B.unreadable
          : S.sourceNone;
  // por serviço: a mesma chave pode valer na hora num e só ao reiniciar noutro (registro, `applyIn`)
  const APPLY_TEXT = {
    refresh: S.applyRefresh,
    'next-run': S.applyNextRun,
    restart: S.applyRestart,
  } as const;
  const applyText = def
    ? settingApplyGroups(def)
        .map((g) => fill(APPLY_TEXT[g.apply], { services: services(g.services) }))
        .join(' ')
    : '';
  const canType = editable && Boolean(state?.canSave) && !pending;

  return (
    <Dialog open={setting !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(S.title, { name: def ? settingText(T, def).label : '' })}</DialogTitle>
          <DialogDescription>
            {editable
              ? `${S.description} ${applyText}`
              : fill(B.changeBody, {
                  keys: setting?.key ?? '',
                  services: services(def?.services ?? []),
                })}
          </DialogDescription>
        </DialogHeader>
        {editable && setting && state ? (
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim() && canType) setStep('confirm');
            }}
          >
            <FieldGroup>
              <div className="flex flex-wrap items-center gap-2" data-testid="secret-source">
                <Badge
                  variant={
                    source === 'panel'
                      ? 'primary-light'
                      : source === 'env'
                        ? 'info-light'
                        : source === 'unreadable'
                          ? 'destructive-light'
                          : 'secondary'
                  }
                >
                  {sourceText}
                </Badge>
                {state.changedBy ? (
                  <span className="text-muted-foreground text-xs">
                    {fill(S.changedBy, { by: state.changedBy })}
                  </span>
                ) : null}
              </div>
              {!state.canSave ? (
                <Alert variant="warning">
                  <CircleAlert />
                  <AlertDescription>{S.noKekHelp}</AlertDescription>
                </Alert>
              ) : null}
              {state.unreadable ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{S.unreadableHelp}</AlertDescription>
                </Alert>
              ) : null}
              {state.kekMissing.length ? (
                <Alert variant="warning">
                  <CircleAlert />
                  <AlertDescription>
                    {fill(S.kekMissingHelp, { services: services(state.kekMissing) })}
                  </AlertDescription>
                </Alert>
              ) : null}
              {state.kekMismatch.length ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>
                    {fill(S.kekMismatchHelp, { services: services(state.kekMismatch) })}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`secret-${setting.key}`}>{S.newValue}</FieldLabel>
                <Input
                  id={`secret-${setting.key}`}
                  name={`secret-${setting.key}`}
                  type="password"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setTested(null);
                    setStep('edit');
                  }}
                  placeholder={S.placeholder}
                  disabled={!canType}
                  autoComplete="new-password"
                  spellCheck={false}
                  autoCapitalize="none"
                  className="font-mono text-xs"
                />
                <FieldDescription>
                  <code className="font-mono text-xs">{setting.key}</code>
                  {tested === 'ok' ? ` · ${S.testOk}` : ''}
                </FieldDescription>
              </Field>
              {step === 'confirm' ? (
                <Alert variant="info">
                  <CircleAlert />
                  <AlertDescription>{S.confirmHint}</AlertDescription>
                </Alert>
              ) : null}
              {step === 'reset' ? (
                <Alert variant="info">
                  <CircleAlert />
                  <AlertDescription>{S.resetHint}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter className="flex-wrap gap-2">
                {state.inPanel ? (
                  step === 'reset' ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => resetSecret(setting.key), S.resetDone, true)}
                    >
                      {pending ? <Spinner /> : <RotateCcw />}
                      {S.resetConfirm}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setStep('reset')}
                    >
                      <RotateCcw />
                      {S.reset}
                    </Button>
                  )
                ) : null}
                {state.testable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canType || !value.trim()}
                    onClick={() => run(() => testSecret(setting.key, value), S.testOk, false)}
                  >
                    {pending && step === 'edit' ? <Spinner /> : <FlaskConical />}
                    {pending && step === 'edit' ? S.testing : S.test}
                  </Button>
                ) : null}
                {step === 'confirm' ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => saveSecret(setting.key, value), S.saved, true)}
                  >
                    {pending ? <Spinner /> : <Save />}
                    {S.confirm}
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!canType || !value.trim()}>
                    <Save />
                    {S.save}
                  </Button>
                )}
              </DialogFooter>
            </FieldGroup>
          </form>
        ) : (
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{B.close}</DialogClose>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
