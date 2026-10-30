/**
 * Momentos do canal do jogo (docs/07 §2.2.4). A escala de transmissão sai pelo menos uma semana antes,
 * então a pesquisa é por rodada (competição × rodada) em poucos momentos:
 *
 *   weekly     consulta semanal (WTW_CHANNEL_WEEKLY_CRON, padrão segunda 06:00 UTC): as rodadas cujo
 *              primeiro jogo cai entre `tick + maior retentativa` e `próximo tick + maior retentativa`
 *              (padrão: de 3 a 10 dias à frente). Cada rodada entra em uma consulta só.
 *   retry-Nd   retentativas (WTW_CHANNEL_RETRY_OFFSETS, padrão `3d,1d,6h`) antes do primeiro jogo ainda por
 *              começar da rodada — só para os jogos × mercados SEM canal confirmado.
 *   post       3 h depois do último jogo do dia, até 72 h (WTW_CHANNEL_POST): só os encerrados sem canal.
 *
 * Jogo × mercado com canal confirmado nunca volta à pesquisa (o filtro é do plano). Uma chamada cobre
 * todos os jogos e mercados do grupo (competição × rodada × momento). A retentativa que abriria menos de
 * 24 h depois da consulta semanal que cobriu a rodada não roda (a consulta fez o papel dela).
 */
import { Cron } from 'croner';

export type ChannelWindowName = 'weekly' | 'post' | 'manual' | `retry-${string}`;

export interface ChannelWindow {
  window: ChannelWindowName;
  phase: 'pre' | 'post';
  /** Tick da consulta semanal (weekly), `round` (retentativas), o dia da rodada (post) ou `manual`. */
  bucket: string;
  opensAt: Date;
}

const H = 3_600_000;
const D = 24 * H;

export const CHANNEL_POST_OPENS_MS = 3 * H;
export const CHANNEL_POST_CLOSES_MS = 72 * H;
/** Folga do horizonte para os demais jogos de uma rodada que começa perto do limite. */
export const CHANNEL_ROUND_SPREAD_MS = 4 * D;
/** Retentativa que abre menos que isso depois da consulta semanal da rodada é dispensada. */
export const CHANNEL_RETRY_MIN_GAP_MS = 24 * H;

export const DEFAULT_CHANNEL_WEEKLY_CRON = '0 6 * * 1';
export const DEFAULT_CHANNEL_RETRY_OFFSETS = '3d,1d,6h';
export const DEFAULT_CHANNEL_POST = 'on';

export interface RetryOffset {
  /** `retry-3d`, `retry-1d`, `retry-6h` — entra no `purpose` e na chave da pesquisa. */
  label: `retry-${string}`;
  ms: number;
}

export interface ChannelSchedule {
  /** Cron (5 campos, UTC) da consulta semanal; null = desligada. */
  weeklyCron: string | null;
  /** Retentativas, da mais cedo para a mais tarde. */
  retries: RetryOffset[];
  /** Passada depois do jogo para os encerrados sem canal. */
  post: boolean;
}

const OFF = new Set(['off', 'false', 'disabled', '0', 'none']);
const CRON_OPTIONS = { paused: true, mode: '5-part', timezone: 'UTC' } as const;
const MIN_OFFSET_MS = H;
const MAX_OFFSET_MS = 14 * D;

/**
 * `3d,1d` → [retry-3d, retry-1d]; aceita horas (`36h`, `6h`); `off` (ou vazio explícito) = sem
 * retentativas. Duplicadas caem; ordem: a mais cedo primeiro. Inválido → null.
 */
export function parseRetryOffsets(raw: string): RetryOffset[] | null {
  const text = raw.trim().toLowerCase();
  if (OFF.has(text)) return [];
  const out = new Map<number, RetryOffset>();
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)([dh])$/.exec(part);
    if (!m) return null;
    const hours = Number(m[1]) * (m[2] === 'd' ? 24 : 1);
    const ms = hours * H;
    if (ms < MIN_OFFSET_MS || ms > MAX_OFFSET_MS) return null;
    const label = hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
    out.set(ms, { label: `retry-${label}`, ms });
  }
  if (!out.size) return null;
  return [...out.values()].sort((a, b) => b.ms - a.ms);
}

function validCron(pattern: string): boolean {
  if (pattern.split(' ').length !== 5) return false;
  try {
    new Cron(pattern, CRON_OPTIONS).stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * Momentos do env: WTW_CHANNEL_WEEKLY_CRON (cron UTC ou `off`), WTW_CHANNEL_RETRY_OFFSETS (`3d,1d`,
 * `off`) e WTW_CHANNEL_POST (`on`/`off`). Vazio = padrão; valor inválido → erro na partida.
 */
export function channelScheduleFromEnv(
  env: Record<string, string | undefined> = process.env,
): ChannelSchedule {
  const cronRaw = (env.WTW_CHANNEL_WEEKLY_CRON?.trim() || DEFAULT_CHANNEL_WEEKLY_CRON).replace(/\s+/g, ' ');
  let weeklyCron: string | null = null;
  if (!OFF.has(cronRaw.toLowerCase())) {
    if (!validCron(cronRaw))
      throw new Error(`WTW_CHANNEL_WEEKLY_CRON inválido: "${cronRaw}" (cron de 5 campos em UTC, ou off).`);
    weeklyCron = cronRaw;
  }
  const offsetsRaw = env.WTW_CHANNEL_RETRY_OFFSETS?.trim() || DEFAULT_CHANNEL_RETRY_OFFSETS;
  const retries = parseRetryOffsets(offsetsRaw);
  if (!retries)
    throw new Error(
      `WTW_CHANNEL_RETRY_OFFSETS inválido: "${offsetsRaw}" (ex.: 3d,1d ou 36h; de 1 h a 14 d; ou off).`,
    );
  const postRaw = (env.WTW_CHANNEL_POST?.trim() || DEFAULT_CHANNEL_POST).toLowerCase();
  if (!['on', 'off', 'true', 'false', '1', '0'].includes(postRaw))
    throw new Error(`WTW_CHANNEL_POST inválido: "${postRaw}" (on ou off).`);
  return { weeklyCron, retries, post: ['on', 'true', '1'].includes(postRaw) };
}

export interface SweepTicks {
  /** Última execução da consulta semanal (≤ agora). */
  current: Date;
  /** Próxima execução. */
  next: Date;
}

/** Os momentos resolvidos para um instante (o cron vira datas). */
export interface ChannelMoments {
  retries: RetryOffset[];
  post: boolean;
  /** Maior retentativa (0 sem retentativas): a consulta semanal pula as rodadas que já estão nela. */
  leadMs: number;
  /** Consulta semanal vigente; null = desligada. */
  sweep: SweepTicks | null;
  /** Tick da consulta semanal que cobre a rodada cuja âncora menos o lead é `at` (null = desligada). */
  sweepCovering: (at: Date) => Date | null;
}

export function channelMoments(schedule: ChannelSchedule, now: Date): ChannelMoments {
  const leadMs = schedule.retries.length ? Math.max(...schedule.retries.map((r) => r.ms)) : 0;
  const base = { retries: schedule.retries, post: schedule.post, leadMs };
  if (!schedule.weeklyCron) return { ...base, sweep: null, sweepCovering: () => null };
  const cron = new Cron(schedule.weeklyCron, CRON_OPTIONS);
  const previous = (at: Date): Date | null => {
    // previousRuns devolve as execuções estritamente antes da referência (em segundos): +1 s inclui o tick
    const [prev] = cron.previousRuns(1, new Date(at.getTime() + 1000));
    return prev ?? null;
  };
  const current = previous(now);
  const next = cron.nextRun(now);
  return {
    ...base,
    sweep: current && next ? { current, next } : null,
    sweepCovering: previous,
  };
}

/** Rótulo do tick na chave do grupo (sem ":"): 2026-10-26T06h00. */
export const tickBucket = (tick: Date) => tick.toISOString().slice(0, 16).replace(':', 'h');

/**
 * Dia da rodada do jogo: a data UTC 6 h antes do início (o jogo das 21h30 de Brasília, 00h30 UTC,
 * fica no dia em que é jogado nas Américas).
 */
export const dayBucket = (startsAt: Date) => new Date(startsAt.getTime() - 6 * H).toISOString().slice(0, 10);

export interface WindowAnchors {
  /** Início do primeiro jogo ainda por começar da rodada. */
  roundStart: Date;
  /** Início do último jogo do dia do jogo (na rodada). */
  dayLastStart: Date;
}

const PRE_STATUSES = new Set(['scheduled', 'starting']);
export const POST_STATUSES = new Set(['finished', 'abandoned']);

/**
 * Momento vigente do jogo agora, ou null. Quem decide se o jogo × mercado entra é o plano: com canal
 * confirmado, nunca.
 */
export function dueChannelWindow(
  e: { startsAt: Date; status: string },
  anchors: WindowAnchors,
  moments: ChannelMoments,
  now: Date,
): ChannelWindow | null {
  const t = now.getTime();
  const start = e.startsAt.getTime();
  if (POST_STATUSES.has(e.status)) {
    if (!moments.post) return null;
    const opens = anchors.dayLastStart.getTime() + CHANNEL_POST_OPENS_MS;
    if (t >= opens && t <= start + CHANNEL_POST_CLOSES_MS)
      return { window: 'post', phase: 'post', bucket: dayBucket(e.startsAt), opensAt: new Date(opens) };
    return null;
  }
  if (!PRE_STATUSES.has(e.status) || t >= start) return null;
  const anchor = Math.min(anchors.roundStart.getTime(), start);

  // consulta semanal: rodada da faixa deste tick e ainda fora das retentativas
  const sweep = moments.sweep;
  if (
    sweep &&
    t < anchor - moments.leadMs &&
    anchor >= sweep.current.getTime() + moments.leadMs &&
    anchor < sweep.next.getTime() + moments.leadMs
  )
    return { window: 'weekly', phase: 'pre', bucket: tickBucket(sweep.current), opensAt: sweep.current };

  // retentativa vigente: a que abriu por último
  let due: RetryOffset | null = null;
  for (const r of moments.retries) if (t >= anchor - r.ms && (!due || r.ms < due.ms)) due = r;
  if (!due) return null;
  const opensAt = anchor - due.ms;
  const covering = moments.sweepCovering(new Date(anchor - moments.leadMs));
  if (covering && opensAt >= covering.getTime() && opensAt < covering.getTime() + CHANNEL_RETRY_MIN_GAP_MS)
    return null;
  return { window: due.label, phase: 'pre', bucket: 'round', opensAt: new Date(opensAt) };
}

/** Horizonte dos jogos futuros que podem entrar em algum momento agora. */
export function channelHorizonMs(moments: ChannelMoments, now: Date): number {
  const untilNext = moments.sweep ? Math.max(0, moments.sweep.next.getTime() - now.getTime()) : 0;
  return untilNext + moments.leadMs + CHANNEL_ROUND_SPREAD_MS + 10 * 60_000;
}
