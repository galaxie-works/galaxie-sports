/**
 * Grade de esportes nos canais do cliente (widget `channel_guide`, issue #834): cruza o onde assistir dos
 * jogos do dia (opções confirmadas e o canal do jogo confirmado pelo job `wtw-channel`) com a lista de canais
 * confirmada do tenant. Puro: a rota lê as linhas e este módulo monta a grade.
 */
import type { ClientChannelRef } from '@galaxie/contracts';
import { isEditorial } from '@galaxie/where-to-watch';

/** Opção do onde assistir (versão vigente) de um jogo no país do widget. */
export interface GuideOptionRow {
  eventId: string;
  broadcasterId: string | null;
  channelName: string | null;
  /** UF/praça da opção regional; null = nacional. */
  region: string | null;
  status: string;
  producedBy: string;
}

/** Canal do jogo confirmado (`enrich.match_channel`, status `confirmed`). */
export interface GuideMatchRow {
  eventId: string;
  broadcasterId: string;
  channelName: string | null;
}

/** O pedaço da lista confirmada que a grade usa (`ConfirmedChannels.carrying`). */
export interface GuideChannelList {
  carrying(country: string, broadcasterId: string | null, channel?: string | null): ClientChannelRef[];
}

/** Máximo de canais escolhidos num widget (o Builder e a rota cortam no mesmo número). */
export const GUIDE_MAX_CHANNELS = 200;

/** Canais escolhidos no widget (`options.channels`, um por linha) → conjunto, ou null (todos). */
export function parseGuideChannels(raw: unknown): ReadonlySet<string> | null {
  if (typeof raw !== 'string') return null;
  const names = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, GUIDE_MAX_CHANNELS);
  return names.length ? new Set(names) : null;
}

/** Esportes pedidos (`?sport=`, separados por vírgula) ou o salvo no widget, ou null (todos). */
export function parseGuideSports(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const sports = [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(s)),
    ),
  ].sort();
  return sports.length ? sports : null;
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/**
 * Canais da lista do cliente que passam cada jogo: as opções confirmadas e os canais do jogo confirmados (os
 * que a editoria retirou ou omitiu não voltam por aqui, como no onde assistir), levados aos canais da lista;
 * com `only`, só os canais escolhidos no widget. Jogo sem canal da lista fica fora do mapa.
 */
export function guideChannelsByEvent(
  country: string,
  options: readonly GuideOptionRow[],
  matches: readonly GuideMatchRow[],
  list: GuideChannelList,
  only: ReadonlySet<string> | null,
): Map<string, string[]> {
  const key = (eventId: string, broadcasterId: string | null) => `${eventId}:${broadcasterId}`;
  const removed = new Set(
    options
      .filter((r) => isEditorial(r) && (r.status === 'retracted' || r.status === 'omitted'))
      .map((r) => key(r.eventId, r.broadcasterId)),
  );
  const matchOf = new Map(matches.map((m) => [key(m.eventId, m.broadcasterId), m]));
  const confirmed = options.filter((r) => r.status === 'confirmed' && r.broadcasterId);
  const published = new Set(confirmed.map((r) => key(r.eventId, r.broadcasterId)));
  // como no onde assistir: a opção nacional (não editorial) leva o canal confirmado do jogo ("SporTV" vira
  // "SporTV 2"); o canal do jogo só entra sozinho quando a emissora não tem opção publicada nem foi retirada
  const sources = [
    ...confirmed.map((r) => {
      const m = matchOf.get(key(r.eventId, r.broadcasterId));
      return r.region === null && !isEditorial(r) && m?.channelName
        ? { ...r, channelName: m.channelName }
        : r;
    }),
    ...matches.filter(
      (m) => !published.has(key(m.eventId, m.broadcasterId)) && !removed.has(key(m.eventId, m.broadcasterId)),
    ),
  ];
  const byEvent = new Map<string, Set<string>>();
  for (const s of sources) {
    for (const ref of list.carrying(country, s.broadcasterId, s.channelName)) {
      if (only && !only.has(ref.name)) continue;
      let set = byEvent.get(s.eventId);
      if (!set) byEvent.set(s.eventId, (set = new Set()));
      set.add(ref.name);
    }
  }
  return new Map([...byEvent].map(([id, names]) => [id, [...names].sort(collator.compare)]));
}

/** Canais com algum jogo no dia, em ordem alfabética. */
export function guideChannelNames(byEvent: ReadonlyMap<string, readonly string[]>): string[] {
  return [...new Set([...byEvent.values()].flat())].sort(collator.compare);
}
