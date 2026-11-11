'use client';

import {
  CarFront,
  Dumbbell,
  Hand,
  History,
  MoreVertical,
  RotateCcw,
  Trophy,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Baseball } from '@/components/icons/baseball';
import { Basketball } from '@/components/icons/basketball';
import { HockeyStick } from '@/components/icons/hockey-stick';
import { RugbyBall } from '@/components/icons/rugby-ball';
import { SoccerBall } from '@/components/icons/soccer-ball';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { IconTile } from '@/components/reui/icon-tile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';
import { cn } from '@/lib/utils';

import { historyHref, resettableKeys } from './logic';
import { useSaveSettings } from './use-save-settings';

/** Ícone de cada API da api-sports (os que o lucide não tem estão em components/icons). */
const SPORT_ICONS: Readonly<Record<string, LucideIcon>> = {
  football: SoccerBall,
  afl: RugbyBall,
  baseball: Baseball,
  basketball: Basketball,
  nba: Basketball,
  'formula-1': CarFront,
  handball: Hand,
  hockey: HockeyStick,
  mma: Dumbbell,
  'american-football': RugbyBall,
  rugby: RugbyBall,
  volleyball: Volleyball,
};

export function SportIcon({ api, className }: { api: string; className?: string }) {
  const Icon = SPORT_ICONS[api] ?? Trophy;
  return <Icon aria-hidden="true" className={className} />;
}

export interface SportRow {
  api: string;
  /** Âncora da linha (a chave do registro), para o "ver em…" e a busca abrirem a página nela. */
  id?: string;
  /** Outras chaves da mesma linha (ex.: os minutos do pós-jogo), também como âncora. */
  alsoIds?: readonly string[];
  label: string;
  description?: ReactNode;
  /** Algum valor da linha vem do painel: selo "alterado". */
  changed?: boolean;
  /**
   * Os ajustes da linha (ex.: modo e minutos do pós-jogo). Com eles a linha ganha o menu ⋮ ("Voltar ao padrão do
   * .env", "Ver no histórico") e o selo "inválido" quando alguma sobrescrita gravada não vale.
   */
  settings?: readonly OpsSetting[];
  /** Controles à direita (campo com unidade, select, switch). */
  controls: ReactNode;
}

export interface SportRowsTableProps {
  title: string;
  description?: string;
  /** Linhas já em ordem (alfabética do idioma: `sportsByLabel`). */
  rows: readonly SportRow[];
  /** Antes das linhas (ex.: o teto do dia do pós-jogo). */
  before?: ReactNode;
  /** Rodapé: "Desligar todos", "Desfazer", "Salvar". */
  footer?: ReactNode;
}

/**
 * Uma linha por esporte no desenho do bloco `settings-2` (#1075), com componentes gratuitos: `icon-tile` do esporte,
 * nome, selo "alterado" e descrição à esquerda; os controles na mesma linha à direita (descem em telas estreitas).
 */
export function SportRowsTable({ title, description, rows, before, footer }: SportRowsTableProps) {
  const { t } = useI18n();
  return (
    <Frame>
      <FrameHeader>
        <FrameTitle>{title}</FrameTitle>
        {description ? <FrameDescription>{description}</FrameDescription> : null}
      </FrameHeader>
      <FramePanel className="p-0">
        {before}
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.api}
              id={row.id}
              data-sport={row.api}
              className={cn(
                'flex scroll-mt-24 flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0',
                row.changed && 'bg-primary/5',
              )}
            >
              {row.alsoIds?.map((id) => (
                <span key={id} id={id} className="sr-only scroll-mt-24" aria-hidden="true" />
              ))}
              <IconTile size="sm" aria-hidden="true">
                <SportIcon api={row.api} />
              </IconTile>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  {row.changed ? <Badge variant="primary-light">{t.ops.blocks.changed}</Badge> : null}
                  {row.settings?.some((s) => s.overrideInvalid) ? (
                    <Badge variant="destructive-light">{t.ops.blocks.invalid}</Badge>
                  ) : null}
                </div>
                {row.description ? (
                  <div className="text-muted-foreground text-xs">{row.description}</div>
                ) : null}
              </div>
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                {row.controls}
                {row.settings?.length ? (
                  <SportRowMenu label={row.label} settings={row.settings} historyKey={row.id} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </FramePanel>
      {footer ? (
        <FrameFooter className="flex-row flex-wrap items-center justify-end gap-2">{footer}</FrameFooter>
      ) : null}
    </Frame>
  );
}

/**
 * Menu ⋮ da linha do esporte, como o da linha de ajuste: "Voltar ao padrão do .env" (com confirmação) apaga a
 * sobrescrita de cada chave da linha que tem uma, uma por vez e cada uma no histórico; "Ver no histórico" abre o
 * histórico filtrado na chave da linha.
 */
function SportRowMenu({
  label,
  settings,
  historyKey,
}: {
  label: string;
  settings: readonly OpsSetting[];
  historyKey?: string | undefined;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const router = useRouter();
  const { pending, apply } = useSaveSettings();
  const [confirm, setConfirm] = useState(false);
  const keys = resettableKeys(settings);
  const key = historyKey ?? settings[0]!.key;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={fill(T.blocks.rowMenu, { name: label })} />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={pending || !keys.length} onClick={() => setConfirm(true)}>
            <RotateCcw />
            {T.blocks.resetToEnv}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(historyHref(key))}>
            <History />
            {T.blocks.viewHistory}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(T.actions.resetTitle, { name: label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(T.blocks.sports.resetBody, { keys: keys.join(', ') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                apply({ reset: keys }, T.feedback.reset);
              }}
            >
              {T.actions.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
