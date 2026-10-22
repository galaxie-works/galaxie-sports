'use client';

import { Radio, RefreshCw, Satellite } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useNow } from '@/hooks/use-now';
import { cn } from '@/lib/utils';

import type { LiveRefreshState } from './use-live-refresh';

const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));

/** Idade legível: segundos, minutos, horas ou dias. */
export function fmtAge(ms: number): string {
  const s = secs(ms);
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/** Anel de progresso até a próxima atualização agendada. */
function Ring({ progress, active }: { progress: number; active: boolean }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} className="stroke-muted fill-none" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        className={cn(
          'fill-none transition-[stroke-dashoffset] duration-500 ease-linear',
          active ? 'stroke-primary' : 'stroke-muted-foreground',
        )}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
      />
    </svg>
  );
}

const MECHANISM: Record<LiveRefreshState['mechanism'], { label: string; hint: string }> = {
  sse: {
    label: 'Tempo real (SSE)',
    hint: 'Conectado ao /v1/stream: placar, relógio e lances chegam por push. A verificação completa pela REST roda a cada 30 s.',
  },
  polling: {
    label: 'Polling (REST)',
    hint: 'Sem conexão SSE no momento: a página consulta a REST a cada 15 s e reconecta o stream sozinha.',
  },
  idle: {
    label: 'Aguardando jogos',
    hint: 'Nenhum jogo ao vivo: a página procura novos apitos a cada 60 s.',
  },
  static: { label: 'Encerrado', hint: 'Jogo encerrado: o conteúdo não muda mais.' },
};

/**
 * Cadência visível da página: "Atualizado há 4 s · próxima atualização em 11 s", o anel até a próxima
 * verificação, o mecanismo real (SSE ou polling) e a cadência da fonte (leituras do fornecedor pelo Live
 * Poller, medidas pelo `last_valid_at`).
 */
export function RefreshTimer({
  state,
  sourceLastAt,
  className,
}: {
  state: LiveRefreshState;
  /** Última leitura do fornecedor (o `last_valid_at` mais recente), ISO. */
  sourceLastAt?: string | null;
  className?: string;
}) {
  const now = useNow(500);
  const { mechanism, intervalMs, updatedAt, lastSignalAt } = state;
  const mech = MECHANISM[mechanism];
  const elapsed = now != null && updatedAt ? now - updatedAt : null;
  const remaining = elapsed != null && intervalMs != null ? intervalMs - elapsed : null;
  const sourceAge = now != null && sourceLastAt ? now - Date.parse(sourceLastAt) : null;

  return (
    <div
      className={cn(
        'bg-card text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-xs',
        className,
      )}
      aria-live="off"
    >
      <span className="flex items-center gap-2">
        <Ring
          progress={elapsed != null && intervalMs ? elapsed / intervalMs : 0}
          active={mechanism === 'sse' || mechanism === 'polling'}
        />
        <span className="text-foreground tabular-nums">
          {elapsed == null ? 'Atualizando…' : `Atualizado há ${secs(elapsed)} s`}
          {remaining != null ? (
            <span className="text-muted-foreground">
              {' · '}
              {remaining > 0 ? `próxima atualização em ${secs(remaining)} s` : 'atualizando…'}
            </span>
          ) : null}
        </span>
      </span>

      <Tooltip>
        <TooltipTrigger render={<span className="flex cursor-help items-center gap-1.5" />}>
          {mechanism === 'sse' ? (
            <Radio className="text-live size-3.5" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          {mech.label}
          {mechanism === 'sse' && lastSignalAt && now != null ? (
            <span className="tabular-nums">· último sinal há {fmtAge(now - lastSignalAt)}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{mech.hint}</TooltipContent>
      </Tooltip>

      {mechanism !== 'static' ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex cursor-help items-center gap-1.5 tabular-nums" />}>
            <Satellite className="size-3.5" aria-hidden />
            Fonte: Live Poller, a cada ≥ 15 s
            {sourceAge != null && sourceAge >= 0 ? ` · última leitura há ${fmtAge(sourceAge)}` : null}
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            O Live Poller da Galaxie lê o fornecedor no máximo a cada 15 s, com o ritmo ajustado ao orçamento
            de chamadas do dia e à fase do jogo (mais rápido na reta final, pausa no intervalo). A última
            leitura vem de data_freshness.last_valid_at.
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
