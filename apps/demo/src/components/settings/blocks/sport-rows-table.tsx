'use client';

import { CarFront, Dumbbell, Hand, Trophy, Volleyball, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

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
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

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
  label: string;
  description?: ReactNode;
  /** Algum valor da linha vem do painel: selo "alterado". */
  changed?: boolean;
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
              data-sport={row.api}
              className={cn(
                'flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0',
                row.changed && 'bg-primary/5',
              )}
            >
              <IconTile size="sm" aria-hidden="true">
                <SportIcon api={row.api} />
              </IconTile>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  {row.changed ? <Badge variant="primary-light">{t.ops.blocks.changed}</Badge> : null}
                </div>
                {row.description ? (
                  <div className="text-muted-foreground text-xs">{row.description}</div>
                ) : null}
              </div>
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">{row.controls}</div>
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
