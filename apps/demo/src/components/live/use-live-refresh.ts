'use client';

import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

/** Verificação completa com o SSE conectado (o push traz as mudanças; isto só ressincroniza). */
export const SSE_RESYNC_MS = 30_000;
/** Sem SSE (falhou ou indisponível): polling da REST. */
export const POLL_MS = 15_000;
/** Nada ao vivo: só procura jogos que começaram. */
export const IDLE_MS = 60_000;
/** Rajada de mudanças (vários jogos no mesmo tick do poller) vira uma busca só. */
const DEBOUNCE_MS = 750;

const TOPICS = ['event.score_changed', 'event.status_changed', 'event.incident_added'] as const;

export type RefreshMechanism = 'sse' | 'polling' | 'idle' | 'static';

export interface LiveRefreshState {
  mechanism: RefreshMechanism;
  /** Intervalo da próxima atualização agendada (ms); null quando não há (jogo encerrado). */
  intervalMs: number | null;
  /** Última atualização bem-sucedida (ms epoch). */
  updatedAt: number;
  /** Último sinal recebido pelo SSE (ms epoch). */
  lastSignalAt: number | null;
}

/**
 * Mantém uma consulta do React Query viva: assina o SSE da API (`/v1/stream`, pelo proxy) para os
 * eventos dados e busca de novo a cada mudança; além disso agenda a próxima verificação completa a
 * partir da última atualização (30 s com SSE, 15 s sem SSE, 60 s sem jogo ao vivo). O contador da
 * tela mostra exatamente esse agendamento.
 */
export function useLiveRefresh(opts: {
  queryKey: QueryKey;
  /** Eventos a acompanhar no SSE; vazio = sem SSE (só a verificação periódica). */
  eventIds: string[];
  /** false = conteúdo estático (jogo encerrado): nada de SSE nem de agendamento. */
  enabled: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}): LiveRefreshState {
  const { queryKey, eventIds, enabled, dataUpdatedAt, errorUpdatedAt } = opts;
  const queryClient = useQueryClient();
  const [sseOpen, setSseOpen] = useState(false);
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);
  const keyRef = useRef(queryKey);
  useEffect(() => {
    keyRef.current = queryKey;
  });
  const ids = eventIds.slice(0, 200).sort().join(',');

  // ─ SSE: cada mudança dos eventos acompanhados dispara uma nova busca (com debounce) ─
  useEffect(() => {
    if (!enabled || !ids || typeof EventSource === 'undefined') {
      setSseOpen(false);
      return;
    }
    const params = new URLSearchParams({ events: ids, topics: 'score,status,incidents' });
    const es = new EventSource(`/api/galaxie/v1/stream?${params}`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      setLastSignalAt(Date.now());
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: keyRef.current });
      }, DEBOUNCE_MS);
    };
    es.onopen = () => setSseOpen(true);
    es.onerror = () => setSseOpen(es.readyState === EventSource.OPEN);
    es.addEventListener('ready', () => setSseOpen(true));
    for (const t of TOPICS) es.addEventListener(t, onChange);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
      setSseOpen(false);
    };
  }, [enabled, ids, queryClient]);

  const mechanism: RefreshMechanism = !enabled ? 'static' : !ids ? 'idle' : sseOpen ? 'sse' : 'polling';
  const intervalMs =
    mechanism === 'static'
      ? null
      : mechanism === 'idle'
        ? IDLE_MS
        : mechanism === 'sse'
          ? SSE_RESYNC_MS
          : POLL_MS;

  // ─ verificação agendada: próxima = última atualização (ou erro) + intervalo ─
  const last = Math.max(dataUpdatedAt, errorUpdatedAt);
  useEffect(() => {
    if (intervalMs == null) return;
    const wait = Math.max(0, last + intervalMs - Date.now());
    const t = setTimeout(() => {
      void queryClient.refetchQueries({ queryKey: keyRef.current, type: 'active' });
    }, wait);
    return () => clearTimeout(t);
  }, [last, intervalMs, queryClient]);

  return { mechanism, intervalMs, updatedAt: dataUpdatedAt, lastSignalAt };
}
