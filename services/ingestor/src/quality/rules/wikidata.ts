/**
 * Wikidata e títulos: o QID ligado a um time nosso é da mesma categoria (principal, feminino, base, reserva) e o
 * título só conta para o time com ligação segura (`core.provider_map`, provider `wikidata`).
 */
import { sql } from 'drizzle-orm';
import { WIKIDATA_API } from '../../assets/commons/client.js';
import type { QualityFailureItem, QualityRule } from '../types.js';

export type TeamCategory = 'main' | 'women' | 'youth' | 'reserve';

/** Categoria pelo sufixo do nosso nome (" W", " U20", " Sub-20", " II", " B", " Res."), como o `isSeniorMenName`. */
export function categoryFromName(name: string): TeamCategory {
  const n = name.trim();
  if (/\s(W|Women|Fem\.?|Femenino|Feminino)$/i.test(n)) return 'women';
  if (/(\sU\d{2}|\sSub-?\d{2})$/i.test(n)) return 'youth';
  if (/\s(II|III|B|Res\.?|Reserves?)$/i.test(n)) return 'reserve';
  return 'main';
}

const WOMEN =
  /\bwomen\b|\bwomen's\b|\bladies\b|\bfemenin[oa]\b|\bfeminin[oa]\b|\bfemmes?\b|\bfrauen\b|\bdamen\b/i;
const YOUTH =
  /\byouth\b|\bacademy\b|\bu-?\d{2}\b|\bunder[- ]\d{2}\b|\bsub-?\d{2}\b|\bjuvenil\b|categorias? de base|\bcantera\b/i;
const RESERVE =
  /\breserves?\b|\breserve (team|side)\b|\bB team\b|\bfilial\b|\bCastilla\b|\bequipo B\b|\btime B\b/i;
/** Sufixo de reserva no rótulo ("Baník Ostrava B", "Hoffenheim II"); no meio não conta ("Juan Pablo II College"). */
const RESERVE_SUFFIX = /\s(II|III|B)$/;

/**
 * Categoria do item do Wikidata pelo rótulo e pela descrição (os apelidos ficam de fora: o do Hoffenheim inclui
 * "1899 Hoffenheim II"). "Boca Juniors" não é base: "juniors" não entra na lista.
 */
export function categoryFromWikidata(
  labels: readonly string[],
  descriptions: readonly string[] = [],
): TeamCategory {
  const all = [...labels, ...descriptions].join(' | ');
  if (WOMEN.test(all)) return 'women';
  if (YOUTH.test(all)) return 'youth';
  if (RESERVE.test(all) || labels.some((l) => RESERVE_SUFFIX.test(l.trim()))) return 'reserve';
  return 'main';
}

/** Competição feminina pelo nome (o vencedor precisa ser time feminino). */
export const competitionCategory = (name: string): TeamCategory => (WOMEN.test(name) ? 'women' : 'main');

type Entity = {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  missing?: string;
};

export const WIKIDATA_RULES: QualityRule[] = [
  {
    id: 'wikidata.team-category',
    sport: 'all',
    area: 'wikidata',
    severity: 'critical',
    description: {
      'pt-BR':
        'O QID do Wikidata ligado a um time é da mesma categoria: principal com principal, nunca com feminino, base ou reserva',
      en: 'The Wikidata QID linked to a team is of the same category: senior with senior, never women, youth or reserves',
      es: 'El QID de Wikidata ligado a un equipo es de la misma categoría: principal con principal, nunca femenino, juvenil o reserva',
    },
    origin: 'erro achado pelo dono do produto na demo (24/10/2026): times ligados aos femininos',
    needs: ['wikidata'],
    check: async (ctx) => {
      const links = await ctx.db.execute<{
        qid: string;
        id: string;
        name: string;
        sport: string;
        kind: string;
      }>(sql`
        select m.provider_id as qid, p.id::text, p.name, p.sport, p.kind::text
          from core.provider_map m join core.participant p on p.id = m.entity_id
         where m.provider = 'wikidata' and m.entity_type = 'participant' and p.kind in ('club', 'national_team')`);
      const entities = new Map<string, Entity>();
      const qids = [...new Set(links.map((l) => l.qid))];
      for (let i = 0; i < qids.length; i += 50) {
        const body = (await ctx.wikimedia.get(WIKIDATA_API, {
          action: 'wbgetentities',
          ids: qids.slice(i, i + 50).join('|'),
          props: 'labels|descriptions',
          languages: 'en|pt|pt-br|es',
        })) as { entities?: Record<string, Entity> };
        for (const [id, e] of Object.entries(body.entities ?? {})) entities.set(id, e);
      }
      const checked: Record<string, number> = {};
      const failures: QualityFailureItem[] = [];
      for (const l of links) {
        const e = entities.get(l.qid);
        if (!e || e.missing !== undefined) continue;
        checked[l.sport] = (checked[l.sport] ?? 0) + 1;
        const ours = categoryFromName(l.name);
        const theirs = categoryFromWikidata(
          Object.values(e.labels ?? {}).map((t) => t.value),
          Object.values(e.descriptions ?? {}).map((t) => t.value),
        );
        if (ours !== theirs)
          failures.push({
            key: `${l.id}:${l.qid}`,
            sport: l.sport,
            label: l.name,
            current:
              `${l.qid} (${theirs}): ${e.labels?.en?.value ?? e.labels?.pt?.value ?? ''} — ${e.descriptions?.en?.value ?? ''}`.trim(),
            expected: `QID de time ${ours}`,
            link: { type: 'participant', id: l.id, kind: l.kind, name: l.name },
          });
      }
      return { checked, failures };
    },
  },
  {
    id: 'titles.safe-link-only',
    sport: 'football',
    area: 'wikidata',
    severity: 'critical',
    description: {
      'pt-BR':
        'Título só conta para o time ligado com segurança ao vencedor (QID no provider_map) ou corrigido na curadoria',
      en: 'A title only counts for the team safely linked to the winner (QID in provider_map) or fixed by curation',
      es: 'Un título solo cuenta para el equipo ligado con seguridad al ganador (QID en provider_map) o corregido por curaduría',
    },
    origin: 'erro achado pelo dono do produto na demo (24/10/2026): campeões errados vindos do Wikidata',
    check: async (ctx) => {
      const rows = await ctx.db.execute<{
        id: string;
        team_id: string;
        team: string;
        competition: string;
        season: string;
        winner_qid: string;
        linked: boolean;
      }>(sql`
        select t.id::text, p.id::text as team_id, p.name as team, c.name as competition, t.season_label as season,
               t.winner_qid,
               exists (select 1 from core.provider_map m
                        where m.provider = 'wikidata' and m.entity_type = 'participant'
                          and m.entity_id = t.participant_id and m.provider_id = t.winner_qid) as linked
          from core.competition_title t
          join core.participant p on p.id = t.participant_id
          join core.competition c on c.id = t.competition_id
         where t.source <> 'curated'`);
      return {
        checked: rows.length,
        failures: rows
          .filter((r) => !r.linked)
          .map((r) => ({
            key: r.id,
            label: `${r.competition} ${r.season} · ${r.team}`,
            current: `contado sem ligação (${r.winner_qid})`,
            expected: `${r.winner_qid} no provider_map do time`,
            link: { type: 'participant', id: r.team_id, name: r.team },
          })),
      };
    },
  },
  {
    id: 'titles.winner-category',
    sport: 'football',
    area: 'wikidata',
    severity: 'critical',
    description: {
      'pt-BR':
        'O título de competição principal vai para o time principal; o de competição feminina, para o time feminino',
      en: "A senior competition's title goes to the senior team; a women's competition's title, to the women's team",
      es: 'El título de una competición principal va al equipo principal; el de una femenina, al equipo femenino',
    },
    origin: 'erro achado pelo dono do produto na demo (24/10/2026): títulos contados para times femininos',
    check: async (ctx) => {
      const rows = await ctx.db.execute<{
        id: string;
        team_id: string;
        team: string;
        competition: string;
        season: string;
      }>(sql`
        select t.id::text, p.id::text as team_id, p.name as team, c.name as competition, t.season_label as season
          from core.competition_title t
          join core.participant p on p.id = t.participant_id
          join core.competition c on c.id = t.competition_id`);
      return {
        checked: rows.length,
        failures: rows
          .filter((r) => {
            const want = competitionCategory(r.competition);
            const got = categoryFromName(r.team);
            return want === 'women' ? got !== 'women' : got !== 'main';
          })
          .map((r) => ({
            key: r.id,
            label: `${r.competition} ${r.season} · ${r.team}`,
            current: `${r.team} (${categoryFromName(r.team)})`,
            expected: `time ${competitionCategory(r.competition)}`,
            link: { type: 'participant', id: r.team_id, name: r.team },
          })),
      };
    },
  },
];
