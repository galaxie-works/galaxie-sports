/**
 * Descarte barato do Agente Resumo: antes de montar os fatos de cada jogo (umas 7 consultas por jogo mais a conta da
 * tabela), uma consulta só calcula para todos os candidatos um carimbo do que entra nos fatos e o compara com o
 * carimbo gravado na última vez em que os fatos daquele jogo foram montados. Igual, dentro da validade
 * (RECAP_INPUT_MAX_AGE_HOURS, painel › IA, padrão 6 h), e com os textos gravados estáveis: o jogo sai da fila sem
 * nenhuma consulta própria (os fatos seriam os mesmos e o hash deles também, então o caminho inteiro terminaria em
 * "fatos inalterados").
 *
 * O carimbo cobre o jogo (a linha de core.event inteira), os incidentes (as linhas inteiras e o maior `updated_at` das
 * pessoas deles, que dão os nomes de quem marcou e deu a assistência), as estatísticas (core.football_fixture), os
 * participantes, a competição, a fase, os jogos e a tabela da temporada (maior `updated_at` e quantidade, para a tabela
 * de antes e depois e os jogos restantes), os locales pedidos e a versão do prompt. O que não tem carimbo (títulos,
 * regulamento, perfil do time, estádio, clássico) fica coberto pela validade: passada ela desde o carimbo, o jogo passa
 * pelo caminho inteiro de novo. Carimbos mais velhos que a validade são apagados no fim de cada execução.
 *
 * Os textos gravados precisam estar estáveis: um locale sem texto, ou cujo texto mais recente caiu no determinístico
 * por falha do LLM ou por orçamento (que o caminho inteiro tenta de novo, `latestFactsHashes`), mantém o jogo na fila.
 * O carimbo fica em ops.sync_cursor (provedor `agents`, endpoint `recap:insumo`, chave = id do jogo).
 */
import { sql } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';

export const RECAP_INPUT_PROVIDER = 'agents';
export const RECAP_INPUT_ENDPOINT = 'recap:insumo';
/** Validade padrão do carimbo: cobre o que ele não enxerga (títulos, regulamento, nomes do perfil do time). */
export const DEFAULT_RECAP_INPUT_MAX_AGE_HOURS = 6;

/** RECAP_INPUT_MAX_AGE_HOURS do env (o do painel chega pelo `runtimeEnv`) em ms; de 1 a 72 h, inválido = o padrão. */
export function recapInputMaxAgeMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RECAP_INPUT_MAX_AGE_HOURS?.trim() || NaN);
  const hours = Number.isInteger(n) && n >= 1 && n <= 72 ? n : DEFAULT_RECAP_INPUT_MAX_AGE_HOURS;
  return hours * 3_600_000;
}
/** Determinístico que o caminho inteiro não refaz com os mesmos fatos (os outros motivos tentam o LLM de novo). */
const STABLE_FALLBACKS = ['rejected', 'no_llm', 'missing'];

export interface RecapInputState {
  /** Carimbo atual do insumo do jogo. */
  stamp: string;
  /** O insumo é o mesmo da última montagem dos fatos, dentro da validade, e os textos gravados estão estáveis. */
  unchanged: boolean;
}

const list = (xs: readonly string[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

/** Carimbo de cada jogo e se ele pode sair da fila (uma consulta para todos). */
export async function recapInputStates(
  db: Database,
  eventIds: readonly string[],
  opts: { now: Date; locales: readonly string[]; version: string; maxAgeMs?: number },
): Promise<Map<string, RecapInputState>> {
  const out = new Map<string, RecapInputState>();
  if (!eventIds.length) return out;
  const locales = [...new Set(opts.locales)].sort();
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_RECAP_INPUT_MAX_AGE_HOURS * 3_600_000;
  const validSince = new Date(opts.now.getTime() - maxAgeMs).toISOString();
  // sem JIT: a estimativa das subconsultas da temporada passa do jit_optimize_above_cost e a compilação custava 1,3 s
  // de CPU numa consulta de 150 ms (dev, 200 jogos)
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`set local jit = off`);
    return tx.execute<{
      id: string;
      stamp: string;
      stored: string | null;
      no_facts: boolean | null;
      texts_ok: boolean;
    }>(sql`
    with ev as (
      select e.* from core.event e where e.id in (${list(eventIds)})
    ), seasons as (
      select s.season_id,
             (select concat_ws(':', max(x.updated_at), count(*)) from core.event x where x.season_id = s.season_id)
               as games,
             (select concat_ws(':', max(t.updated_at), count(*)) from core.standing t where t.season_id = s.season_id)
               as standing
        from (select distinct season_id from ev where season_id is not null) s
    )
    select ev.id,
           md5(concat_ws('|',
             ${opts.version}::text,
             ${locales.join(',')}::text,
             md5(ev::text),
             (select md5(coalesce(string_agg(i::text, '|' order by i.id), ''))
                from core.event_incident i where i.event_id = ev.id),
             greatest(
               (select max(pe.updated_at) from core.event_incident i
                  join core.person pe on pe.id = i.person_id where i.event_id = ev.id),
               (select max(pe.updated_at) from core.event_incident i
                  join core.person pe on pe.id = i.assist_person_id where i.event_id = ev.id)
             )::text,
             (select md5(f::text) from core.football_fixture f where f.event_id = ev.id),
             (select string_agg(concat_ws(':', md5(ep::text), p.updated_at), ',' order by ep.participant_id)
                from core.event_participant ep join core.participant p on p.id = ep.participant_id
               where ep.event_id = ev.id),
             (select c.updated_at::text from core.competition c where c.id = ev.competition_id),
             (select md5(st::text) from core.stage st where st.id = ev.stage_id),
             s.games,
             s.standing
           )) as stamp,
           cur.cursor->>'stamp' as stored,
           (cur.cursor->>'noFacts')::boolean as no_facts,
           (select count(*) = ${locales.length}
                   and coalesce(bool_and(
                     l.content->>'origin' is distinct from 'fallback'
                     or coalesce(
                          l.content->>'fallbackReason',
                          case when coalesce((l.content->'run'->>'llmCalls')::int, 0) > 0
                                and jsonb_array_length(coalesce(l.content->'run'->'errors', '[]'::jsonb)) > 0
                               then 'llm_error' else 'missing' end
                        ) in (${list(STABLE_FALLBACKS)})), false)
              from (select distinct on (x.locale) x.locale, x.content
                      from enrich.event_context x
                     where x.event_id = ev.id and x.kind = 'recap' and x.review_status <> 'rejected'
                       and x.locale in (${list(locales)})
                     order by x.locale, x.created_at desc) l) as texts_ok
      from ev
      left join seasons s on s.season_id = ev.season_id
      left join ops.sync_cursor cur
        on cur.provider = ${RECAP_INPUT_PROVIDER} and cur.sport = 'football'
       and cur.endpoint = ${RECAP_INPUT_ENDPOINT} and cur.key = ev.id::text
       and cur.completed_at >= ${validSince}::timestamptz`);
  });
  for (const r of rows)
    out.set(r.id, {
      stamp: r.stamp,
      // encerrado sem placar não tem texto: com o mesmo insumo, os fatos continuam vazios
      unchanged: r.stored === r.stamp && (r.texts_ok === true || r.no_facts === true),
    });
  return out;
}

/** Apaga os carimbos mais velhos que a validade (jogo que saiu da janela não volta a ser conferido). */
export async function pruneRecapInputStamps(db: Database, now: Date, maxAgeMs: number): Promise<number> {
  const before = new Date(now.getTime() - maxAgeMs).toISOString();
  const rows = await db.execute<{ n: number }>(sql`
    with gone as (
      delete from ops.sync_cursor
       where provider = ${RECAP_INPUT_PROVIDER} and endpoint = ${RECAP_INPUT_ENDPOINT}
         and completed_at < ${before}::timestamptz
      returning 1)
    select count(*)::int as n from gone`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Grava o carimbo dos jogos cujos fatos foram montados agora (gravados ou conferidos sem mudança); `noFacts` marca o
 * encerrado sem placar, que não tem texto para conferir.
 */
export async function saveRecapInputStamps(
  db: Database,
  stamps: readonly { eventId: string; stamp: string; noFacts?: boolean }[],
  now: Date,
): Promise<void> {
  if (!stamps.length) return;
  await db
    .insert(syncCursor)
    .values(
      stamps.map((s) => ({
        provider: RECAP_INPUT_PROVIDER,
        sport: 'football',
        endpoint: RECAP_INPUT_ENDPOINT,
        key: s.eventId,
        cursor: s.noFacts ? { stamp: s.stamp, noFacts: true } : { stamp: s.stamp },
        completedAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: {
        cursor: sql`excluded.cursor`,
        completedAt: sql`excluded.completed_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
