import type { RawRecord, StoredRawRecord } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';

/** Consulta ao raw: endpoint + filtros sobre os parâmetros normalizados da requisição. */
/** Esporte e endpoint de um lote de hashes: deixa o Postgres usar o índice (provider, sport, endpoint, request_hash). */
export interface RawScopeKey {
  sport: string;
  endpoint: string;
}

export interface RawQuery {
  sport: string;
  endpoint: string;
  /** Parâmetros que precisam estar presentes. */
  has?: string[] | undefined;
  /** Parâmetros que não podem estar presentes. */
  lacks?: string[] | undefined;
  /** Igualdade exata de parâmetros. */
  where?: Record<string, string> | undefined;
}

export interface RawEntry {
  params: Record<string, string>;
  response: unknown;
  paging: { current: number; total: number } | null;
  fetchedAt: Date;
}

/**
 * Leitura do raw pelos jobs (zero cota): os planos de chamadas dependentes (detalhe de partidas,
 * pessoas, h2h) são montados a partir do que já foi baixado.
 */
/** Resumo de um item de `response` em /fixtures ou /fixtures/headtohead (os campos de `FixtureRef`). */
export interface RawFixtureRow {
  id: number;
  status: string;
  date: string;
  leagueId: number;
  season: number;
  round: string | null;
  homeId: number | null;
  awayId: number | null;
  fetchedAt: Date;
}

export interface RawSource {
  /**
   * Resposta de sucesso mais recente de cada requisição distinta que casa com a consulta; `fetchedAt` é a última
   * vez que o fornecedor a entregou (o raw não duplica corpo igual, só estende o "visto em").
   */
  latest(query: RawQuery): AsyncIterable<RawEntry>;
  /**
   * Opcional: as partidas das mesmas respostas de `latest`, já resumidas pela fonte, sem trazer o corpo. Uma lista
   * de temporada ou a agenda mundial de um dia passa de MB de JSON, e montar o detalhe de todas pelo `latest`
   * estourava o heap do contêiner (06/11/2026). Quem não implementa cai no `latest`.
   */
  fixtureRows?(query: RawQuery): AsyncIterable<RawFixtureRow>;
  /** Última entrega de sucesso por request hash (para o `--plan`: cache × rede). */
  lastFetched(hashes: string[], scope?: RawScopeKey): Promise<Map<string, Date>>;
  /**
   * `paging` da resposta de sucesso mais recente de cada request hash (sem o corpo): pelo índice
   * (provider, sport, endpoint, request_hash), sem varrer o endpoint inteiro.
   */
  latestPaging(
    sport: string,
    endpoint: string,
    hashes: string[],
  ): Promise<Map<string, { current: number; total: number } | null>>;
}

function isSuccess(r: Pick<RawRecord, 'statusCode' | 'errors'>): boolean {
  if (r.statusCode < 200 || r.statusCode >= 300) return false;
  const e = r.errors;
  if (e == null) return true;
  if (Array.isArray(e)) return e.length === 0;
  return typeof e === 'object' && Object.keys(e).length === 0;
}

export function matchesQuery(params: Record<string, string>, q: RawQuery): boolean {
  if (q.has?.some((k) => params[k] === undefined)) return false;
  if (q.lacks?.some((k) => params[k] !== undefined)) return false;
  if (q.where && Object.entries(q.where).some(([k, v]) => params[k] !== v)) return false;
  return true;
}

/** Sobre os registros do InMemoryRawStore (testes unitários e simulações). */
const seenAt = (r: RawRecord | StoredRawRecord): Date =>
  ('lastSeenAt' in r ? r.lastSeenAt : null) ?? r.fetchedAt;

export class InMemoryRawSource implements RawSource {
  constructor(private readonly records: (RawRecord | StoredRawRecord)[]) {}

  async *latest(query: RawQuery): AsyncIterable<RawEntry> {
    const byHash = new Map<string, RawRecord>();
    for (const r of this.records) {
      if (r.sport !== query.sport || r.endpoint !== query.endpoint || !isSuccess(r)) continue;
      if (!matchesQuery(r.params, query)) continue;
      const prev = byHash.get(r.requestHash);
      if (!prev || prev.fetchedAt <= r.fetchedAt) byHash.set(r.requestHash, r);
    }
    for (const r of byHash.values()) {
      const body = r.body as { response?: unknown; paging?: { current: number; total: number } };
      yield {
        params: r.params,
        response: body.response,
        paging: body.paging ?? null,
        fetchedAt: seenAt(r),
      };
    }
  }

  async lastFetched(hashes: string[]): Promise<Map<string, Date>> {
    const wanted = new Set(hashes);
    const out = new Map<string, Date>();
    for (const r of this.records) {
      if (!wanted.has(r.requestHash) || !isSuccess(r)) continue;
      const prev = out.get(r.requestHash);
      if (!prev || prev < seenAt(r)) out.set(r.requestHash, seenAt(r));
    }
    return out;
  }

  async latestPaging(
    sport: string,
    endpoint: string,
    hashes: string[],
  ): Promise<Map<string, { current: number; total: number } | null>> {
    const wanted = new Set(hashes);
    const latest = new Map<string, RawRecord>();
    for (const r of this.records) {
      if (r.sport !== sport || r.endpoint !== endpoint || !wanted.has(r.requestHash) || !isSuccess(r))
        continue;
      const prev = latest.get(r.requestHash);
      if (!prev || prev.fetchedAt <= r.fetchedAt) latest.set(r.requestHash, r);
    }
    const out = new Map<string, { current: number; total: number } | null>();
    for (const [hash, r] of latest)
      out.set(hash, (r.body as { paging?: { current: number; total: number } }).paging ?? null);
    return out;
  }
}

/**
 * raw.api_response, lido em lotes por cursor (respostas de temporada inteira são grandes).
 * Datas saem como epoch em ms: o driver do Drizzle desliga a conversão de timestamptz do postgres.js.
 */
export class PgRawSource implements RawSource {
  constructor(
    private readonly db: Database,
    private readonly batchSize = 50,
    /** Linhas por lote do cursor de `fixtureRows` (cada linha é uma partida resumida, não uma resposta). */
    private readonly fixtureBatchSize = 5000,
  ) {}

  async *latest(query: RawQuery): AsyncIterable<RawEntry> {
    const { where, values } = this.filter(query);
    const text = `select distinct on (request_hash)
        params, body->'response' as response, body->'paging' as paging,
        (extract(epoch from coalesce(last_seen_at, fetched_at)) * 1000)::float8 as fetched_ms
      from raw.api_response
      where ${where}
      order by request_hash, fetched_at desc`;
    const cursor = this.db.$client.unsafe(text, values as never[]).cursor(this.batchSize);
    for await (const rows of cursor) {
      for (const row of rows as unknown as {
        params: Record<string, string>;
        response: unknown;
        paging: { current: number; total: number } | null;
        fetched_ms: number;
      }[]) {
        yield {
          params: row.params,
          response: row.response,
          paging: row.paging,
          fetchedAt: new Date(row.fetched_ms),
        };
      }
    }
  }

  /**
   * As mesmas respostas de `latest`, com cada partida resumida no banco: só os campos de `FixtureRef` chegam ao
   * Node. As guardas repetem o `isApiFixture` (id da partida e da liga numéricos, `teams` presente).
   */
  async *fixtureRows(query: RawQuery): AsyncIterable<RawFixtureRow> {
    const { where, values } = this.filter(query);
    // inteiro de até 9 dígitos (cabe no int4); decimal, texto ou número maior viram null em vez de derrubar a consulta
    const isInt = (path: string) =>
      `(jsonb_typeof(${path}) = 'number' and (${path})::text ~ '^-?[0-9]{1,9}$')`;
    const int = (path: string) => `case when ${isInt(path)} then (${path})::text::int end`;
    // a ordem de saída repete a do `latest` (por request_hash, e na ordem do array): o collectFixtures desempata
    // fetchedAt iguais pela ordem de chegada
    const text = `with latest as (
        select distinct on (request_hash)
          request_hash,
          body->'response' as response,
          (extract(epoch from coalesce(last_seen_at, fetched_at)) * 1000)::float8 as fetched_ms
        from raw.api_response
        where ${where}
        order by request_hash, fetched_at desc
      )
      select ${int(`e.f->'fixture'->'id'`)} as id,
        coalesce(e.f->'fixture'->'status'->>'short', 'NS') as status,
        coalesce(e.f->'fixture'->>'date', '') as date,
        ${int(`e.f->'league'->'id'`)} as league_id,
        ${int(`e.f->'league'->'season'`)} as season,
        e.f->'league'->>'round' as round,
        ${int(`e.f->'teams'->'home'->'id'`)} as home_id,
        ${int(`e.f->'teams'->'away'->'id'`)} as away_id,
        l.fetched_ms
      from latest l
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(l.response) = 'array' then l.response else '[]'::jsonb end
      ) with ordinality as e(f, n)
      where ${isInt(`e.f->'fixture'->'id'`)}
        and ${isInt(`e.f->'league'->'id'`)}
        and coalesce(jsonb_typeof(e.f->'teams'), 'null') <> 'null'
      order by l.request_hash, e.n`;
    // um Date por resposta, não por partida: são até 1,25 milhão de linhas e poucas mil respostas
    const dates = new Map<number, Date>();
    const dateOf = (ms: number) => {
      let d = dates.get(ms);
      if (!d) dates.set(ms, (d = new Date(ms)));
      return d;
    };
    const cursor = this.db.$client.unsafe(text, values as never[]).cursor(this.fixtureBatchSize);
    for await (const rows of cursor) {
      for (const r of rows as unknown as {
        id: number;
        status: string;
        date: string;
        league_id: number;
        season: number;
        round: string | null;
        home_id: number | null;
        away_id: number | null;
        fetched_ms: number;
      }[]) {
        yield {
          id: r.id,
          status: r.status,
          date: r.date,
          leagueId: r.league_id,
          season: r.season,
          round: r.round,
          homeId: r.home_id,
          awayId: r.away_id,
          fetchedAt: dateOf(r.fetched_ms),
        };
      }
    }
  }

  private filter(query: RawQuery): { where: string; values: unknown[] } {
    const values: unknown[] = [query.sport, query.endpoint];
    const conditions = [
      `provider = 'api-sports'`,
      `sport = $1`,
      `endpoint = $2`,
      `status_code between 200 and 299`,
      `(errors is null or errors in ('[]'::jsonb, '{}'::jsonb))`,
    ];
    if (query.has?.length) {
      values.push(query.has);
      conditions.push(`params ?& $${values.length}::text[]`);
    }
    if (query.lacks?.length) {
      values.push(query.lacks);
      conditions.push(`not (params ?| $${values.length}::text[])`);
    }
    if (query.where && Object.keys(query.where).length) {
      values.push(JSON.stringify(query.where));
      conditions.push(`params @> $${values.length}::jsonb`);
    }
    return { where: conditions.join(' and '), values };
  }

  async lastFetched(hashes: string[], scope?: RawScopeKey): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    const unique = [...new Set(hashes)];
    for (let i = 0; i < unique.length; i += 5000) {
      const chunk = unique.slice(i, i + 5000);
      // com esporte e endpoint, o filtro casa com o prefixo do api_response_lookup_idx (request_hash é a 4ª coluna)
      const scoped = scope ? `provider = 'api-sports' and sport = $2 and endpoint = $3 and ` : '';
      const rows = (await this.db.$client.unsafe(
        `select request_hash, (extract(epoch from max(coalesce(last_seen_at, fetched_at))) * 1000)::float8 as fetched_ms
           from raw.api_response
          where ${scoped}request_hash = any($1::text[])
            and status_code between 200 and 299
            and (errors is null or errors in ('[]'::jsonb, '{}'::jsonb))
          group by request_hash`,
        (scope ? [chunk, scope.sport, scope.endpoint] : [chunk]) as never[],
      )) as unknown as { request_hash: string; fetched_ms: number }[];
      for (const r of rows) out.set(r.request_hash, new Date(r.fetched_ms));
    }
    return out;
  }

  async latestPaging(
    sport: string,
    endpoint: string,
    hashes: string[],
  ): Promise<Map<string, { current: number; total: number } | null>> {
    const out = new Map<string, { current: number; total: number } | null>();
    const unique = [...new Set(hashes)];
    for (let i = 0; i < unique.length; i += 5000) {
      const rows = (await this.db.$client.unsafe(
        `select distinct on (request_hash) request_hash, body->'paging' as paging
           from raw.api_response
          where provider = 'api-sports' and sport = $1 and endpoint = $2
            and request_hash = any($3::text[])
            and status_code between 200 and 299
            and (errors is null or errors in ('[]'::jsonb, '{}'::jsonb))
          order by request_hash, fetched_at desc`,
        [sport, endpoint, unique.slice(i, i + 5000)] as never[],
      )) as unknown as { request_hash: string; paging: { current: number; total: number } | null }[];
      for (const r of rows) out.set(r.request_hash, r.paging);
    }
    return out;
  }
}
