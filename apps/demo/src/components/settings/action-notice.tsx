'use client';

import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { useI18n } from '@/lib/i18n/client';

export type ActionNoticeTone = 'info' | 'warning' | 'error';

const VARIANT = { info: 'info', warning: 'warning', error: 'destructive' } as const;
const ICON = { info: Info, warning: TriangleAlert, error: CircleAlert } as const;

/**
 * Faixa de estado (informação, alerta, erro) com o botão que resolve. Só o erro interrompe o leitor de
 * tela (`role="alert"`); informação e alerta entram como `status`, sem cortar a leitura.
 */
export function ActionNotice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: ActionNoticeTone;
  title?: ReactNode;
  children: ReactNode;
  /** O botão que resolve (ex.: "Comprar créditos", "Ver planos"). */
  action?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const Icon = ICON[tone];
  return (
    <Alert
      variant={VARIANT[tone]}
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={className}
    >
      <Icon aria-hidden />
      {title ? <AlertTitle>{title}</AlertTitle> : <span className="sr-only">{t.settings.notice[tone]}</span>}
      <AlertDescription>{children}</AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
