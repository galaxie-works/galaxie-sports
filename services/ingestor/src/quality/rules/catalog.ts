/** Cadastro: escudo dos times das competições tier 1 e data de nascimento plausível no elenco atual. */
import { sql } from 'drizzle-orm';
import type { QualityRule } from '../types.js';

/** Jogador de elenco atual com mais que isto é erro de cadastro (técnico fica de fora: só `player`). */
export const MAX_PLAYER_AGE = 60;

export const CATALOG_RULES: QualityRule[] = [
  {
    id: 'assets.tier1-team-logo',
    sport: 'all',
    area: 'assets',
    severity: 'high',
    description: {
      'pt-BR': 'Todo time de competição tier 1 (temporada atual) tem escudo',
      en: 'Every team in a tier 1 competition (current season) has a crest',
      es: 'Todo equipo de una competición tier 1 (temporada actual) tiene escudo',
    },
    check: async (ctx) => {
      const rows = await ctx.db.execute<{
        id: string;
        sport: string;
        name: string;
        kind: string;
        competition: string;
        missing: boolean;
      }>(sql`
        with teams as (
          select distinct on (p.id) p.id, p.sport, p.name, p.kind::text, c.name as competition,
                 (p.logo_asset_id is null and p.custom_logo_asset_id is null) as missing
            from core.season s
            join core.competition c on c.id = s.competition_id and c.tier = 1
            join core.event e on e.season_id = s.id
            join core.event_participant ep on ep.event_id = e.id
            join core.participant p on p.id = ep.participant_id and p.kind in ('club', 'national_team')
           where s.current
           order by p.id, c.name
        )
        select id::text, sport, name, kind, competition, missing from teams`);
      const checked: Record<string, number> = {};
      for (const r of rows) checked[r.sport] = (checked[r.sport] ?? 0) + 1;
      return {
        checked,
        failures: rows
          .filter((r) => r.missing)
          .map((r) => ({
            key: r.id,
            sport: r.sport,
            label: `${r.name} · ${r.competition}`,
            current: 'sem escudo',
            expected: 'escudo do fornecedor ou do acervo',
            link: { type: 'participant', id: r.id, kind: r.kind, name: r.name },
          })),
      };
    },
  },
  {
    id: 'people.plausible-birth-date',
    sport: 'all',
    area: 'people',
    severity: 'medium',
    description: {
      'pt-BR': `Jogador de elenco atual não nasceu no futuro nem tem mais de ${MAX_PLAYER_AGE} anos`,
      en: `A current squad player was not born in the future and is not older than ${MAX_PLAYER_AGE}`,
      es: `Un jugador de plantel actual no nació en el futuro ni tiene más de ${MAX_PLAYER_AGE} años`,
    },
    check: async (ctx) => {
      const today = ctx.now.toISOString().slice(0, 10);
      const counts = await ctx.db.execute<{ sport: string; checked: number }>(sql`
        select p.sport, count(distinct pe.id)::int as checked
          from core.roster r
          join core.participant p on p.id = r.participant_id
          join core.person pe on pe.id = r.person_id and pe.birth_date is not null
          left join core.season s on s.id = r.season_id
         where r.role = 'player' and (r.season_id is null or s.current)
         group by p.sport`);
      const rows = await ctx.db.execute<{
        id: string;
        sport: string;
        name: string;
        team: string;
        birth: string;
      }>(sql`
        select id::text, sport, name, team, birth from (
          select distinct on (pe.id) pe.id, p.sport, pe.name, p.name as team, pe.birth_date::text as birth
            from core.roster r
            join core.participant p on p.id = r.participant_id
            join core.person pe on pe.id = r.person_id
            left join core.season s on s.id = r.season_id
           where r.role = 'player' and (r.season_id is null or s.current)
             and (pe.birth_date > ${today}::date
                  or pe.birth_date < ${today}::date - make_interval(years => ${MAX_PLAYER_AGE}))
           order by pe.id, p.name
        ) x`);
      return {
        checked: Object.fromEntries(counts.map((c) => [c.sport, Number(c.checked)])),
        failures: rows.map((r) => ({
          key: r.id,
          sport: r.sport,
          label: `${r.name} · ${r.team}`,
          current: r.birth,
          expected: r.birth > today ? 'data no passado' : `até ${MAX_PLAYER_AGE} anos`,
          link: { type: 'person', id: r.id },
        })),
      };
    },
  },
];
