/**
 * Patrocinadores do cliente (#1021, B10), só no servidor: cadastro com versão otimista, arquivamento e o relatório
 * de impressões. As regras (sem casa de aposta, links https, países e vigência) ficam em `@galaxie/engage`
 * (`validateSponsor`); aqui a leitura e a gravação, sempre filtradas pelo tenant da sessão.
 */
import { validateSponsor, type SponsorInput, type SponsorIssue, type SponsorSurface } from '@galaxie/engage';

import { pool } from '@/lib/auth/db';
import { compiledBaseLists } from '@/lib/engage/moderation-lists';

export interface SponsorRow {
  id: string;
  name: string;
  category: string;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
}

export class SponsorError extends Error {
  constructor(
    readonly code: 'invalid' | 'stale' | 'duplicate' | 'not_found' | 'limit',
    readonly issues: SponsorIssue[] = [],
  ) {
    super(code);
    this.name = 'SponsorError';
  }
}

/** Patrocinadores ativos por cliente. Arquivados não contam. */
export const MAX_SPONSORS = 200;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type DbRow = {
  id: string;
  name: string;
  category: string;
  link_url: string | null;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  countries: string[];
  starts_at: Date | null;
  ends_at: Date | null;
  archived_at: Date | null;
  version: number;
  updated_at: Date;
};

const COLUMNS = `id, name, category, link_url, logo_light_url, logo_dark_url, countries, starts_at, ends_at,
  archived_at, version, updated_at`;

const toRow = (r: DbRow): SponsorRow => ({
  id: r.id,
  name: r.name,
  category: r.category,
  linkUrl: r.link_url,
  logoLightUrl: r.logo_light_url,
  logoDarkUrl: r.logo_dark_url,
  countries: r.countries,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  archivedAt: iso(r.archived_at),
  version: r.version,
  updatedAt: r.updated_at.toISOString(),
});

/** Ativos primeiro, por nome; depois os arquivados. */
export async function listSponsors(tenantId: string): Promise<SponsorRow[]> {
  const { rows } = await pool.query<DbRow>(
    `select ${COLUMNS} from engage.sponsor where tenant_id = $1
      order by archived_at is not null, lower(name), id`,
    [tenantId],
  );
  return rows.map(toRow);
}

/** Cria (`id` nulo) ou altera um patrocinador. O servidor confere de novo com as listas da Galaxie. */
export async function saveSponsor(input: {
  tenantId: string;
  id: string | null;
  expectedVersion: number | null;
  sponsor: SponsorInput;
  actor: string;
}): Promise<SponsorRow> {
  const checked = validateSponsor(input.sponsor, await compiledBaseLists());
  if (!checked.ok) throw new SponsorError('invalid', checked.issues);
  const s = checked.sponsor;
  const values = [
    s.name,
    s.category,
    s.linkUrl,
    s.logoLightUrl,
    s.logoDarkUrl,
    s.countries,
    s.startsAt,
    s.endsAt,
  ];
  try {
    if (input.id === null) {
      // conta e grava na mesma transação, com trava por cliente: duas criações juntas não furam o limite
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`select pg_advisory_xact_lock(hashtextextended('engage.sponsor:' || $1, 0))`, [
          input.tenantId,
        ]);
        const { rows: count } = await client.query<{ n: string }>(
          `select count(*) as n from engage.sponsor where tenant_id = $1 and archived_at is null`,
          [input.tenantId],
        );
        if (Number(count[0]?.n ?? 0) >= MAX_SPONSORS) throw new SponsorError('limit');
        const { rows } = await client.query<DbRow>(
          `insert into engage.sponsor (tenant_id, name, category, link_url, logo_light_url, logo_dark_url, countries,
             starts_at, ends_at, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10) returning ${COLUMNS}`,
          [input.tenantId, ...values, input.actor],
        );
        await client.query('commit');
        return toRow(rows[0]!);
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
    const { rows } = await pool.query<DbRow>(
      `update engage.sponsor set name = $3, category = $4, link_url = $5, logo_light_url = $6, logo_dark_url = $7,
         countries = $8::text[], starts_at = $9, ends_at = $10, updated_by = $11, version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and version = $12 and archived_at is null
       returning ${COLUMNS}`,
      [input.tenantId, input.id, ...values, input.actor, input.expectedVersion],
    );
    if (rows[0]) return toRow(rows[0]);
    throw await missingOrStale(input.tenantId, input.id);
  } catch (err) {
    // nome repetido entre os ativos do mesmo cliente
    if ((err as { code?: string }).code === '23505') throw new SponsorError('duplicate');
    throw err;
  }
}

/** Arquiva: a peça some de todo lugar, o histórico de impressões fica. */
export async function archiveSponsor(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  actor: string;
}): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.sponsor set archived_at = now(), updated_by = $3, version = version + 1, updated_at = now()
      where tenant_id = $1 and id = $2 and version = $4 and archived_at is null`,
    [input.tenantId, input.id, input.actor, input.expectedVersion],
  );
  if (!rowCount) throw await missingOrStale(input.tenantId, input.id);
}

async function missingOrStale(tenantId: string, id: string): Promise<SponsorError> {
  // arquivado também conta como não encontrado: não se edita nem se arquiva de novo
  const { rows } = await pool.query(
    `select 1 from engage.sponsor where tenant_id = $1 and id = $2 and archived_at is null`,
    [tenantId, id],
  );
  return new SponsorError(rows.length ? 'stale' : 'not_found');
}

export interface SponsorReportRow {
  sponsorId: string;
  surface: SponsorSurface;
  surfaceId: string;
  impressions: number;
  days: number;
}

/**
 * Impressões do período (dias em UTC, inclusive), por patrocinador e lugar. Mesma consulta de
 * `sponsorImpressionReport` em `@galaxie/db`; aqui pelo pool da demo, que não importa o pacote inteiro.
 */
export async function sponsorReport(tenantId: string, from: string, to: string): Promise<SponsorReportRow[]> {
  const { rows } = await pool.query<{
    sponsor_id: string;
    surface: SponsorSurface;
    surface_id: string;
    impressions: string;
    days: string;
  }>(
    `select sponsor_id, surface, surface_id, sum(impressions) as impressions, count(distinct day) as days
       from engage.sponsor_impression_daily
      where tenant_id = $1 and day between $2::date and $3::date
      group by sponsor_id, surface, surface_id
      order by sum(impressions) desc`,
    [tenantId, from, to],
  );
  return rows.map((r) => ({
    sponsorId: r.sponsor_id,
    surface: r.surface,
    surfaceId: r.surface_id,
    impressions: Number(r.impressions),
    days: Number(r.days),
  }));
}
