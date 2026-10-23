/**
 * Fonte de dados das páginas de jogo, time, campeonato e pessoa (`components/pages`). No app logado, a
 * API (`apiSource`, os fetchers cacheados de `api.ts`); no exemplo público (`/exemplo`), uma cópia gravada
 * (`lib/example/snapshot.ts`), que nunca chama a API.
 *
 * `showcase` marca o exemplo: as páginas escondem o que não vai para fora (onde assistir, conteúdo
 * relacionado) e os botões "Ver código" somem.
 *
 * Gravação da cópia: com `SHOWCASE_RECORD=<pasta>` no `next dev`, cada leitura da API também vai para
 * `<pasta>/<chave>.json` (`scripts/example-snapshot.mjs` junta tudo depois).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getCompetition,
  getCompetitionEvents,
  getEvent,
  getEventCard,
  getEventContext,
  getH2h,
  getLineups,
  getPersonOverview,
  getRelated,
  getSeasonsWithData,
  getSquad,
  getStandings,
  getStats,
  getTeamCountry,
  getTeamOverview,
  getTeamSemantic,
  getTimeline,
  getWhereToWatch,
} from './api';
import { FETCHER_NAMES, snapshotKey, type FetcherName } from './source-key';

const FETCHERS = {
  getCompetition,
  getCompetitionEvents,
  getEvent,
  getEventCard,
  getEventContext,
  getH2h,
  getLineups,
  getPersonOverview,
  getRelated,
  getSeasonsWithData,
  getSquad,
  getStandings,
  getStats,
  getTeamCountry,
  getTeamOverview,
  getTeamSemantic,
  getTimeline,
  getWhereToWatch,
  // os nomes têm de bater com a lista que o exemplo usa (`source-key.ts`, sem importar a API)
} satisfies Record<FetcherName, (...args: never[]) => Promise<unknown>>;

type Fetchers = typeof FETCHERS;
export type DataSource = Fetchers & { readonly showcase: boolean };

function recorded<K extends FetcherName>(name: K, dir: string): Fetchers[K] {
  const fn = FETCHERS[name] as (...args: unknown[]) => Promise<unknown>;
  return (async (...args: unknown[]) => {
    const value = await fn(...args);
    mkdirSync(dir, { recursive: true });
    const key = snapshotKey(name, args);
    // nome pelo hash da chave: chaves longas (janelas de temporada) não colidem
    const file = `${name}-${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
    writeFileSync(join(dir, `${file}.json`), JSON.stringify({ key, value }));
    return value;
  }) as Fetchers[K];
}

const recordDir = process.env.NODE_ENV === 'development' ? process.env.SHOWCASE_RECORD : undefined;

export const apiSource: DataSource = {
  ...(recordDir
    ? (Object.fromEntries(FETCHER_NAMES.map((name) => [name, recorded(name, recordDir)])) as Fetchers)
    : FETCHERS),
  showcase: false,
};
