/**
 * Motor de regras de qualidade dos dados (job `data-quality`, docs/runbooks/qualidade-dos-dados.md). Uma regra
 * compara o que o core guarda (ou o que a API entrega) com uma referência (F1DB, Wikidata, a própria tabela do
 * fornecedor, o dicionário de emissoras) e devolve os itens errados. O motor roda as regras, conta por esporte,
 * grava o placar em `ops.quality_*` e o painel (Ajustes → Operação → Qualidade) mostra a tendência.
 */
import type { GalaxieClient } from '@galaxie/contracts';
import type { Database, QualityLink, QualitySeverity } from '@galaxie/db';
import type { WikimediaClient } from '../assets/commons/client.js';
import type { F1dbTruth } from './sources/f1db.js';

export type QualityArea = 'f1' | 'events' | 'standings' | 'assets' | 'people' | 'wikidata' | 'watch' | 'geo';

/** Fonte externa de que a regra precisa; sem ela, a regra sai como `skipped` (nunca como `pass`). */
export type QualityNeed = 'api' | 'f1db' | 'wikidata';

/** Item errado. `sport` só quando a regra vale para vários esportes (`sport: '*'`). */
export interface QualityFailureItem {
  /** Chave estável do item na regra: liga a mesma falha entre execuções (tendência e "desde"). */
  key: string;
  label: string;
  current?: string | null;
  expected?: string | null;
  link?: QualityLink | null;
  sport?: string;
}

export interface RuleOutcome {
  /** Itens conferidos: um número (regra de um esporte) ou por esporte (regra `*`). */
  checked: number | Record<string, number>;
  failures: QualityFailureItem[];
  /** Contagem completa de errados, quando a regra só devolve uma amostra em `failures` (padrão: as falhas). */
  failed?: number | Record<string, number>;
}

export interface QualityContext {
  db: Database;
  now: Date;
  env: NodeJS.ProcessEnv;
  /** Cliente da API pública (QUALITY_API_URL + QUALITY_API_KEY); null sem configuração. */
  api: GalaxieClient | null;
  /** Verdade do F1DB do release fixado (carregada uma vez, sob demanda). */
  f1db: () => Promise<F1dbTruth>;
  wikimedia: WikimediaClient;
  /** Carga compartilhada entre regras da mesma execução (ex.: os pilotos lidos da API, uma vez para as quatro). */
  memo: <T>(key: string, load: () => Promise<T>) => Promise<T>;
  log: (msg: string) => void;
}

export interface QualityRule {
  /** `<área>.<o-que-confere>`, estável: vira chave do placar e da tendência. */
  id: string;
  /** Slug do esporte ou `*`. */
  sport: string;
  area: QualityArea;
  severity: QualitySeverity;
  /** O que a regra garante, nos três idiomas do painel. */
  description: { 'pt-BR': string; en: string; es: string };
  /** De onde veio (ex.: um erro achado pelo dono do produto). */
  origin?: string;
  needs?: readonly QualityNeed[];
  check: (ctx: QualityContext) => Promise<RuleOutcome>;
}
