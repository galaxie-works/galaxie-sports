/**
 * Religa times e competições a logos que voltaram: um `team_logo`/`league_logo` que deu 404 (ou foi
 * bloqueado) desligou as entidades; quando o `--retentar-ausentes` consegue baixá-lo, o vínculo só voltaria
 * na próxima normalização do catálogo. Aqui o par id ↔ logo sai da própria resposta do fornecedor já gravada
 * no raw (catálogo `/teams` e `/leagues`, ou os jogos em `/fixtures` e `/games`), normalizada pelo mesmo
 * código do catálogo e da normalização. Zero chamadas à API e nenhuma URL deduzida pelo caminho: sem resposta
 * no raw que traga o logo, a entidade fica como está e o asset é listado em `unresolved`.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { normalizeMediaUrl } from '@galaxie/apisports-client';
import { asset, competition, participant, providerMap, type Database } from '@galaxie/db';
import {
  API_SPORTS_OTHER_SPORTS,
  normalizeFootballEnvelope,
  normalizeSportEnvelope,
  type ApiSportsOtherSport,
  type EnvelopeLike,
} from '@galaxie/providers';
import { parseLeagues } from '../catalog/sport-catalog.js';
import { publishTeamLogoChanges } from './asset-store.js';

export interface RelinkReport {
  /** Times e competições que voltaram a ter o logo. */
  participants: number;
  competitions: number;
  /** Logos sem resposta no raw que diga de quem são (ficam para a próxima normalização do catálogo). */
  unresolved: string[];
}

type EntityType = 'participant' | 'competition';

/** Onde procurar, na ordem: o catálogo (respostas pequenas) e depois os jogos. */
const SOURCE_ENDPOINTS: readonly (readonly string[])[] = [
  ['/teams', '/leagues'],
  ['/fixtures', '/games'],
];

const OTHER_SPORTS: ReadonlySet<string> = new Set(API_SPORTS_OTHER_SPORTS);

type RawSource = {
  sport: string;
  endpoint: string;
  params: Record<string, string | number>;
  fetched_at: Date | string;
  body: unknown;
};

/** Pares (entidade do fornecedor, logo) de uma resposta, pelos mesmos parsers do catálogo e da normalização. */
export function logoPairs(row: Pick<RawSource, 'sport' | 'endpoint' | 'params' | 'body'>, observedAt: Date) {
  const pairs: { entityType: EntityType; providerId: string; url: string }[] = [];
  const response = (row.body as { response?: unknown } | null)?.response;
  if (row.endpoint === '/leagues') {
    for (const l of parseLeagues(response))
      if (l.logo) pairs.push({ entityType: 'competition', providerId: l.id, url: l.logo });
    return pairs;
  }
  const params = Object.fromEntries(Object.entries(row.params ?? {}).map(([k, v]) => [k, String(v)]));
  const envelope = { response } as EnvelopeLike;
  const normalized =
    row.sport === 'football'
      ? normalizeFootballEnvelope(row.endpoint, envelope, observedAt, params)
      : OTHER_SPORTS.has(row.sport)
        ? normalizeSportEnvelope(row.sport as ApiSportsOtherSport, row.endpoint, envelope, observedAt, params)
        : null;
  for (const p of normalized?.batch.participants ?? [])
    if (p.logoUrl) pairs.push({ entityType: 'participant', providerId: p.id, url: p.logoUrl });
  for (const c of normalized?.batch.competitions ?? [])
    if (c.logoUrl) pairs.push({ entityType: 'competition', providerId: c.id, url: c.logoUrl });
  return pairs;
}

/**
 * Religa às `assetIds` (logos agora espelhados) os times e competições que o fornecedor diz usarem cada um e
 * que estão sem logo. Não troca o logo de quem já tem outro. Os times religados são publicados no change feed.
 */
export async function relinkRecoveredLogos(db: Database, assetIds: readonly string[]): Promise<RelinkReport> {
  const report: RelinkReport = { participants: 0, competitions: 0, unresolved: [] };
  if (!assetIds.length) return report;
  const logos = await db
    .select({ id: asset.id, url: asset.sourceUrl, kind: asset.kind })
    .from(asset)
    .where(
      and(
        inArray(asset.id, [...assetIds]),
        inArray(asset.kind, ['team_logo', 'league_logo']),
        isNotNull(asset.storageKey),
      ),
    );

  for (const logo of logos) {
    const url = normalizeMediaUrl(logo.url);
    const path = url && new URL(url).pathname;
    const entityType: EntityType = logo.kind === 'league_logo' ? 'competition' : 'participant';
    let found: { sport: string; providerId: string }[] = [];
    for (const endpoints of path ? SOURCE_ENDPOINTS : []) {
      // a resposta mais recente que cita o arquivo (busca literal, sem regex); pelo id, para parar cedo
      const [row] = await db.execute<RawSource>(sql`
        select sport, endpoint, params, fetched_at, body
        from raw.api_response
        where provider = 'api-sports'
          and endpoint in (${sql.join(
            endpoints.map((e) => sql`${e}`),
            sql`, `,
          )})
          and status_code between 200 and 299
          and strpos(body::text, ${path}) > 0
        order by id desc
        limit 1
      `);
      if (!row) continue;
      found = logoPairs(row, new Date(row.fetched_at))
        .filter((p) => p.entityType === entityType && normalizeMediaUrl(p.url) === url)
        .map((p) => ({ sport: row.sport, providerId: p.providerId }));
      if (found.length) break;
    }
    if (!found.length) {
      report.unresolved.push(logo.url);
      continue;
    }

    await db.transaction(async (tx) => {
      const ids = new Set<string>();
      for (const f of found) {
        const rows = await tx
          .select({ id: providerMap.entityId })
          .from(providerMap)
          .where(
            and(
              eq(providerMap.provider, 'api-sports'),
              eq(providerMap.sport, f.sport),
              eq(providerMap.entityType, entityType),
              eq(providerMap.providerId, f.providerId),
            ),
          );
        for (const r of rows) ids.add(r.id);
      }
      if (!ids.size) return;
      const table = entityType === 'participant' ? participant : competition;
      const relinked = await tx
        .update(table)
        .set({ logoAssetId: logo.id, updatedAt: sql`now()` })
        .where(and(inArray(table.id, [...ids]), isNull(table.logoAssetId)))
        .returning({ id: table.id });
      if (entityType === 'participant') {
        report.participants += relinked.length;
        await publishTeamLogoChanges(
          tx,
          relinked.map((r) => r.id),
        );
      } else report.competitions += relinked.length;
    });
  }
  return report;
}
