/**
 * Fonte de dados do exemplo público (`/exemplo`): responde às mesmas leituras da API com a cópia gravada
 * em `snapshot.json` (`scripts/example-snapshot.mjs`). Nunca chama a API. Leitura que não está na cópia:
 * as principais (jogo, time, campeonato, pessoa) viram "não encontrado"; as demais, ausência (`null`).
 */
import { notFound } from 'next/navigation';

import type { DataSource } from '@/lib/galaxie/source';
import { FETCHER_NAMES, snapshotKey, type FetcherName } from '@/lib/galaxie/source-key';

import data from './snapshot.json';

const SNAPSHOT = data as Record<string, unknown>;

const REQUIRED = new Set<FetcherName>(['getEvent', 'getCompetition', 'getTeamOverview', 'getPersonOverview']);

export const snapshotSource = {
  ...Object.fromEntries(
    FETCHER_NAMES.map((name) => [
      name,
      async (...args: unknown[]) => {
        const key = snapshotKey(name, args);
        if (key in SNAPSHOT) return SNAPSHOT[key];
        if (REQUIRED.has(name)) notFound();
        return null;
      },
    ]),
  ),
  showcase: true,
} as unknown as DataSource;
