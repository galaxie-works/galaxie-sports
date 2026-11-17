/**
 * Gravação e leitura do resumo pré-calculado em `core.explore_summary` (uma linha por esporte e mercado; ver o
 * comentário da tabela em `@galaxie/db`). Quem grava é o job `explore-summary` do ingestor; quem lê é a API.
 */
import { and, count, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { event, exploreSummary, type Database } from '@galaxie/db';
import { IN_PLAY } from './live.js';
import {
  EXPLORE_SNAPSHOT_VERSION,
  type CountryEntry,
  type CountrySportEntry,
  type ExploreSnapshot,
  type SportEntry,
} from './snapshot.js';
import { exploreWindow } from './window.js';

/** Esporte ou mercado da linha que vale para todos. */
export const ALL = '*';
/** O job recalcula sem esperar mudança quando o resumo passa disso. */
export const EXPLORE_REFRESH_MS = 10 * 60_000;
/** Acima disso a API deixa o pré-calculado de lado e calcula na requisição (e o alerta dispara). */
export const EXPLORE_MAX_AGE_MS = 30 * 60_000;
/**
 * Freio (EXPLORE_MIN_INTERVAL_SEC, painel › Agenda): mudança de jogo (status no change feed ou jogo novo) não
 * recalcula antes disso desde a última conta. Com jogo ao vivo algum status muda quase todo minuto, e cada conta lê a
 * janela inteira de jogos; o freio segura a conta a uma a cada N segundos, e a home atrasa no máximo isso.
 */
export const DEFAULT_EXPLORE_MIN_INTERVAL_SEC = 180;

/** O freio do env em ms: inteiro de 0 (sem freio) até `EXPLORE_REFRESH_MS`; vazio ou inválido = o padrão. */
export function exploreMinIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.EXPLORE_MIN_INTERVAL_SEC?.trim();
  const n = raw ? Number(raw) : NaN;
  const sec = Number.isInteger(n) && n >= 0 ? n : DEFAULT_EXPLORE_MIN_INTERVAL_SEC;
  return Math.min(sec * 1000, EXPLORE_REFRESH_MS);
}

export interface ExploreRefreshOptions {
  /** Recalcula sem esperar mudança quando o resumo passa disso (padrão `EXPLORE_REFRESH_MS`). */
  refreshMs?: number;
  /** Freio das mudanças, em ms (padrão `DEFAULT_EXPLORE_MIN_INTERVAL_SEC`); 0 = sem freio. */
  minIntervalMs?: number;
}

interface MetaData {
  version: number;
  window: { from: string; to: string };
}

type Row = typeof exploreSummary.$inferInsert;

/** As linhas do resumo (a de controle primeiro). */
export function snapshotRows(snapshot: ExploreSnapshot): Row[] {
  const generatedAt = snapshot.generatedAt;
  const meta: MetaData = {
    version: snapshot.version,
    window: { from: snapshot.window.from.toISOString(), to: snapshot.window.to.toISOString() },
  };
  return [
    { sport: ALL, market: ALL, data: meta, generatedAt },
    ...Object.entries(snapshot.sports).map(([slug, data]) => ({
      sport: slug,
      market: ALL,
      data,
      generatedAt,
    })),
    ...Object.entries(snapshot.countries).map(([code, data]) => ({
      sport: ALL,
      market: code,
      data,
      generatedAt,
    })),
    ...Object.entries(snapshot.countrySports).flatMap(([code, perSport]) =>
      Object.entries(perSport).map(([slug, data]) => ({ sport: slug, market: code, data, generatedAt })),
    ),
  ];
}

/** O resumo de volta das linhas; null sem a linha de controle ou com outra versão do formato. */
export function snapshotFromRows(
  rows: { sport: string; market: string; data: unknown; generatedAt: Date }[],
): ExploreSnapshot | null {
  const metaRow = rows.find((r) => r.sport === ALL && r.market === ALL);
  const meta = metaRow?.data as MetaData | undefined;
  if (!metaRow || meta?.version !== EXPLORE_SNAPSHOT_VERSION) return null;
  const snapshot: ExploreSnapshot = {
    version: meta.version,
    generatedAt: metaRow.generatedAt,
    window: { from: new Date(meta.window.from), to: new Date(meta.window.to) },
    sports: {},
    countries: {},
    countrySports: {},
  };
  for (const r of rows) {
    if (r.sport === ALL && r.market === ALL) continue;
    if (r.market === ALL) snapshot.sports[r.sport] = r.data as SportEntry;
    else if (r.sport === ALL) snapshot.countries[r.market] = r.data as CountryEntry;
    else (snapshot.countrySports[r.market] ??= {})[r.sport] = r.data as CountrySportEntry;
  }
  return snapshot;
}

/**
 * Troca o resumo inteiro numa transação (quem lê vê o anterior ou o novo, nunca a mistura). A trava da transação
 * enfileira duas gravações simultâneas (uma rodada à mão junto com a do horário) em vez de uma falhar na chave; a
 * que chega por último com uma conta mais velha que a gravada não sobrescreve (devolve 0 linhas).
 */
export async function saveExploreSnapshot(db: Database, snapshot: ExploreSnapshot): Promise<number> {
  const rows = snapshotRows(snapshot);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('core.explore_summary'))`);
    const [stored] = await tx
      .select({ generatedAt: exploreSummary.generatedAt })
      .from(exploreSummary)
      .where(and(eq(exploreSummary.sport, ALL), eq(exploreSummary.market, ALL)));
    if (stored && stored.generatedAt > snapshot.generatedAt) return 0;
    await tx.delete(exploreSummary);
    await tx.insert(exploreSummary).values(rows);
    return rows.length;
  });
}

/** O resumo gravado (null quando ainda não há, ou é de outra versão do formato). */
export async function loadExploreSnapshot(db: Database): Promise<ExploreSnapshot | null> {
  const rows = await db.select().from(exploreSummary);
  return snapshotFromRows(rows);
}

/**
 * Tópicos do change feed que mudam o resumo: status de jogo (agendado → começando → ao vivo → encerrado muda os
 * próximos e os ao vivo; só quando `status` está entre os campos mudados, não o relógio), importância recalculada
 * (`events-importance`: o destaque de cada país) e jogo anunciado criado ou juntado ao oficial. O jogo novo que vem do
 * fornecedor não passa pelo change feed (a normalização não publica inserção); entra na rodada de `refreshMs`.
 */
const SUMMARY_CHANGES = sql`(
  (topic = 'event.status_changed' and payload->'changed' @> '["status"]'::jsonb)
  or topic in ('event.importance_recomputed', 'event.provisional')
)`;

/**
 * Por que recalcular agora (null = o resumo está em dia): não há resumo (ou é de outra versão), passou de
 * `refreshMs`, ou, passado o freio (`minIntervalMs`) desde a última conta, o change feed trouxe mudança de jogo que
 * mexe no resumo (`SUMMARY_CHANGES`) ou entrou jogo novo na janela. A ordem é a do custo: a linha de controle, o change
 * feed pelo índice de `created_at` (só as mudanças desde a conta) e, só quando ele não disparou, o jogo novo pelo
 * índice de `core.event.created_at` (migration 0190; antes, o Postgres lia todos os jogos da janela para filtrar).
 * O change feed grava com o `now()` da transação: uma mudança que começou antes da conta e comitou depois pode
 * escapar desta checagem, e entra na rodada seguinte de `refreshMs`.
 */
export async function exploreRefreshReason(
  db: Database,
  now: Date,
  options: ExploreRefreshOptions = {},
): Promise<string | null> {
  const refreshMs = options.refreshMs ?? EXPLORE_REFRESH_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_EXPLORE_MIN_INTERVAL_SEC * 1000;
  const [meta] = await db
    .select({ data: exploreSummary.data, generatedAt: exploreSummary.generatedAt })
    .from(exploreSummary)
    .where(and(eq(exploreSummary.sport, ALL), eq(exploreSummary.market, ALL)));
  if (!meta) return 'sem resumo gravado';
  if ((meta.data as Partial<MetaData> | null)?.version !== EXPLORE_SNAPSHOT_VERSION)
    return 'formato de outra versão';
  const age = now.getTime() - meta.generatedAt.getTime();
  if (age >= refreshMs) return `resumo com ${Math.round(age / 1000)} s`;
  // freio: a conta é recente. A mudança que chegou nesse meio não se perde: a checagem abaixo olha desde a conta
  if (age < minIntervalMs) return null;
  const [changed] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
      from ops.change_feed
     where created_at >= ${meta.generatedAt.toISOString()}::timestamptz
       and ${SUMMARY_CHANGES}`);
  if (changed && changed.n > 0) return `${changed.n} mudança(s) de jogo no change feed`;
  // jogo novo do fornecedor não passa pelo change feed, e sem isto a home ficava até 10 min atrás da agenda. Os mesmos
  // jogos que a conta lê: da janela ou em andamento. A inserção que comita depois da conta também entra pelo `refreshMs`
  const window = exploreWindow(now);
  const [added] = await db
    .select({ n: count() })
    .from(event)
    .where(
      and(
        gte(event.createdAt, meta.generatedAt),
        or(
          and(gte(event.startsAt, window.from), lt(event.startsAt, window.to)),
          inArray(event.status, IN_PLAY),
        ),
      ),
    );
  return added && added.n > 0 ? `${added.n} jogo(s) novo(s)` : null;
}
