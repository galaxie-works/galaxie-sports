/**
 * Leitura de Ajustes → Escudos (só no servidor): times e competições do futebol com o escudo que vale hoje
 * (o do painel ou do acervo em `custom_logo_asset_id`, senão o do fornecedor), de onde ele vem e se o
 * último envio do painel ainda pode ser desfeito.
 */
import { pool } from '@/lib/auth/db';
import { assetUrl } from '@/lib/lineup/types';

import { type CrestKindFilter, type CrestRow, type CrestSource, type CrestTargetType } from './types';

/**
 * Acentos comparados como a letra sem acento (a base não tem a extensão `unaccent`). Em `\u`: o teste de
 * textos fixos recusa letra acentuada solta no código.
 */
const ACCENTED =
  '\u00e1\u00e0\u00e3\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f3\u00f2\u00f5\u00f4\u00f6\u00fa\u00f9\u00fb\u00fc\u00e7\u00f1\u0131\u00df';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucnis';
const fold = (s: string) => {
  let out = s.toLowerCase();
  for (let i = 0; i < ACCENTED.length; i++) out = out.split(ACCENTED[i]!).join(PLAIN[i]!);
  return out;
};

/** Resultados por busca (a tela é para achar um time, não para navegar o cadastro inteiro). */
export const CREST_SEARCH_LIMIT = 40;

type Row = {
  type: CrestTargetType;
  id: string;
  name: string;
  country: string | null;
  custom_key: string | null;
  custom_source: string | null;
  custom_origin: string | null;
  custom_acervo: string | null;
  provider_key: string | null;
  provider_source: string | null;
  uploaded_by: string | null;
  uploaded_at: Date | null;
  can_revert: boolean;
};

const sourceOf = (r: Row): CrestSource => {
  if (r.custom_key || r.custom_source) return r.custom_acervo === 'painel' ? 'panel' : 'acervo';
  return r.provider_key || r.provider_source ? 'provider' : null;
};

const toCrest = (r: Row): CrestRow => ({
  type: r.type,
  id: r.id,
  name: r.name,
  country: r.country,
  source: sourceOf(r),
  logoUrl: assetUrl(r.custom_key, r.custom_source) ?? assetUrl(r.provider_key, r.provider_source),
  providerUrl: assetUrl(r.provider_key, r.provider_source),
  lastUpload: r.uploaded_by && r.uploaded_at ? { by: r.uploaded_by, at: r.uploaded_at.toISOString() } : null,
  canRevert: r.can_revert === true,
});

/**
 * Último envio ainda valendo (não desfeito); só ele pode ser desfeito, e só se o escudo de hoje for o dele
 * (uma importação depois do envio trocaria o escudo, e aí Voltar não vale mais).
 */
const LAST_UPLOAD = (type: CrestTargetType, alias: string) => `left join lateral (
      select u.uploaded_by, u.created_at, u.asset_id
        from enrich.logo_upload u
       where u.target_type = '${type}' and u.target_id = ${alias}.id::text and u.reverted_at is null
       order by u.created_at desc, u.id desc
       limit 1) u on true`;

const SELECT = (type: CrestTargetType) => {
  const table = type === 'team' ? 'core.participant' : 'core.competition';
  const kindFilter = type === 'team' ? `and t.kind in ('club', 'national_team')` : '';
  return `select '${type}' as type, t.id::text, t.name, t.country_code as country,
        c.storage_key as custom_key, c.source_url as custom_source, c.origin as custom_origin,
        c.acervo as custom_acervo, p.storage_key as provider_key, p.source_url as provider_source,
        u.uploaded_by, u.created_at as uploaded_at,
        coalesce(u.asset_id = t.custom_logo_asset_id, false) as can_revert
      from ${table} t
      left join core.asset c on c.id = t.custom_logo_asset_id
      left join core.asset p on p.id = t.logo_asset_id
      ${LAST_UPLOAD(type, 't')}
     where t.sport = 'football' ${kindFilter}`;
};

/**
 * Times e competições cujo nome (ou nome curto do time) contém o texto, sem diferenciar acento nem
 * caixa; o nome igual ao buscado vem primeiro.
 */
export async function searchCrests(query: string, kind: CrestKindFilter): Promise<CrestRow[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const folded = (col: string) => `translate(lower(${col}), $3, $4)`;
  const parts: string[] = [];
  if (kind !== 'competition')
    parts.push(
      `${SELECT('team')} and (${folded('t.name')} like $1 or ${folded("coalesce(t.short_name, '')")} like $1)`,
    );
  if (kind !== 'team') parts.push(`${SELECT('competition')} and ${folded('t.name')} like $1`);
  const sql = `select * from (${parts.join(' union all ')}) r
    order by (translate(lower(r.name), $3, $4) = $2) desc, length(r.name), r.name
    limit ${CREST_SEARCH_LIMIT}`;
  const { rows } = await pool.query<Row>(sql, [like, q, ACCENTED, PLAIN]);
  return rows.map(toCrest);
}

/** Últimos escudos enviados no painel (o que abre a tela antes de buscar). */
export async function recentCrestUploads(limit = 20): Promise<CrestRow[]> {
  const { rows: recent } = await pool.query<{ target_type: CrestTargetType; target_id: string }>(
    `select target_type, target_id from (
        select distinct on (target_type, target_id) target_type, target_id, created_at
          from enrich.logo_upload
         where target_type in ('team', 'competition')
         order by target_type, target_id, created_at desc) x
      order by created_at desc
      limit $1`,
    [limit],
  );
  if (!recent.length) return [];
  const ids = (type: CrestTargetType) => recent.filter((r) => r.target_type === type).map((r) => r.target_id);
  const { rows } = await pool.query<Row>(
    `${SELECT('team')} and t.id::text = any($1)
     union all
     ${SELECT('competition')} and t.id::text = any($2)`,
    [ids('team'), ids('competition')],
  );
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.id}`, toCrest(r)]));
  return recent.map((r) => byKey.get(`${r.target_type}:${r.target_id}`)).filter((r): r is CrestRow => !!r);
}
