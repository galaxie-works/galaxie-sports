import {
  FactSheetBuilder,
  guardrailSystemRules,
  languageOf,
  type AgentLocale,
  type FactSheet,
} from '../guardrails/index.js';
import { championPhrase, zoneLabel } from '@galaxie/rules';
import { eventNames, teamName, type EventCore, type TeamRef } from '../context/event-core.js';
import type {
  RecapFacts,
  RecapGoal,
  RecapNextStage,
  RecapPlayerEvent,
  RecapStakeFact,
  Side,
} from './facts.js';

/**
 * Agente Resumo pós-jogo (issue #58): o LLM redige 2–4 frases por locale a partir da timeline
 * real; o validador confere nomes, minutos e placares; o fallback monta o resumo direto da timeline.
 */

// v2: desfecho do mata-mata (agregado, quem passou e para onde) e nome curado do estádio
// v4: pontos corridos (o que estava em jogo e o que o resultado mudou) e virada/gol decisivo
export const RECAP_PROMPT_VERSION = 'recap@v4';

/** Fatos citáveis no texto do locale (validador). */
export function recapFactSheet(core: EventCore, facts: RecapFacts, locale: AgentLocale): FactSheet {
  const b = new FactSheetBuilder()
    .name(...eventNames(core))
    .expectResults()
    .expectGoals();
  b.name(facts.teams.home.names[locale], facts.teams.away.names[locale]);
  b.score(facts.final_score.home, facts.final_score.away, { result: true });
  if (facts.halftime) b.score(facts.halftime.home, facts.halftime.away);
  if (facts.penalties) b.score(facts.penalties.home, facts.penalties.away, { result: true });
  if (facts.aggregate) b.score(facts.aggregate.home, facts.aggregate.away, { result: true });
  if (facts.tie?.first_leg) b.score(facts.tie.first_leg.home, facts.tie.first_leg.away);
  b.number(facts.match.round);
  if (facts.champion_titles) b.number(facts.champion_titles.title_number);
  const goalsBy = { home: 0, away: 0 };
  const perScorer = new Map<string, number>();
  for (const g of facts.goals) {
    b.minute(g.minute, g.extra);
    b.person(g.scorer, { goal: 'scorer' });
    b.person(g.assist, { goal: 'assist' });
    if (g.score_after) b.score(g.score_after.home, g.score_after.away);
    goalsBy[g.team]++;
    if (g.scorer) perScorer.set(g.scorer, (perScorer.get(g.scorer) ?? 0) + 1);
  }
  // contagens citáveis: gols por time e por autor ("marcou dois gols")
  b.number(goalsBy.home, goalsBy.away, ...perScorer.values(), facts.goals.length);
  for (const p of facts.missed_penalties) {
    b.minute(p.minute, p.extra);
    b.person(p.player, { goal: 'missed_penalty' });
  }
  for (const r of facts.red_cards) {
    b.minute(r.minute, r.extra);
    b.person(r.player);
  }
  b.number(facts.red_cards.length || null, facts.missed_penalties.length || null);
  if (facts.statistics) {
    for (const side of [facts.statistics.home, facts.statistics.away]) b.number(...Object.values(side));
  }
  if (facts.decided_by === 'extra_time') b.number(120);
  if (facts.flow) b.number(facts.flow.winner_max_deficit || null);
  const lg = facts.league;
  if (lg) {
    b.number(lg.teams_in_table);
    for (const r of [lg.home, lg.away]) {
      b.number(r.rank_before, r.rank_after, r.points_before, r.points_after, r.remaining);
      // "subiu duas posições", "somou três pontos"
      b.number(Math.abs(r.rank_before - r.rank_after) || null, r.points_after - r.points_before || null);
    }
    for (const st of [...lg.before, ...lg.result]) {
      b.name(st.labels[locale]);
      if (st.params?.zone) b.name(zoneLabel(st.params.zone, locale));
      b.number(st.params?.n);
    }
  }
  // confronto decidido: quem caiu não pode aparecer como classificado/campeão (nem o contrário)
  const winner = facts.tie?.winner;
  if (winner) {
    const loser: Side = winner === 'home' ? 'away' : 'home';
    b.outcome(
      [...teamNames(core[winner]), facts.teams[winner].names[locale]],
      [...teamNames(core[loser]), facts.teams[loser].names[locale]],
    );
  }
  return b.build();
}

/** Todos os nomes de um time (provedor, curto, apelidos curados e rótulos por locale). */
const teamNames = (t: TeamRef): string[] => [
  t.name,
  ...(t.shortName ? [t.shortName] : []),
  ...t.aliases,
  ...Object.values(t.labels).filter((v): v is string => !!v),
];

const lowerFirst = (s: string) => (s ? s.charAt(0).toLocaleLowerCase() + s.slice(1) : s);

/**
 * Frase da tabela (pontos corridos): o que o resultado mudou para cada time, com os rótulos fixos dos
 * códigos salientes (até 2 por time, para caber); null sem fatos de tabela.
 */
export function leagueSentence(core: EventCore, facts: RecapFacts, locale: AgentLocale): string | null {
  const lg = facts.league;
  if (!lg) return null;
  const pt = languageOf(locale) === 'pt';
  const side = (team: Side) => {
    const labels = lg.result
      .filter((s: RecapStakeFact) => s.team === team)
      .slice(0, 2)
      .map((s) => s.labels[locale])
      .filter((t): t is string => !!t)
      .map(lowerFirst);
    if (!labels.length) return null;
    const name = teamName(team === 'home' ? core.home : core.away, locale);
    return `${name} ${labels.join(pt ? ' e ' : ' y ')}`;
  };
  const parts = [side('home'), side('away')].filter((x): x is string => !!x);
  if (!parts.length) return null;
  return `${pt ? 'Na tabela' : 'En la tabla'}, ${parts.join('; ')}`;
}

/** Complemento do placar: virada e gol decisivo no fim ou nos acréscimos (vazio sem nada a dizer). */
function flowClause(facts: RecapFacts, locale: AgentLocale): string {
  const f = facts.flow;
  if (!f || facts.decided_by !== 'regular') return '';
  const pt = languageOf(locale) === 'pt';
  const parts: string[] = [];
  if (f.winner && f.winner_max_deficit > 0) parts.push(pt ? 'de virada' : 'dándolo vuelta');
  const g = f.decisive_goal;
  if (g?.late) {
    const when = g.stoppage_time
      ? pt
        ? 'nos acréscimos'
        : 'en el tiempo de descuento'
      : `${pt ? 'aos' : 'a los'} ${minuteText(g)}`;
    if (f.winner) parts.push(pt ? `com o gol da vitória ${when}` : `con el gol del triunfo ${when}`);
    else if (f.came_back_to_draw)
      parts.push(pt ? `com o gol de empate ${when}` : `con el gol del empate ${when}`);
  }
  return parts.length ? `, ${parts.join(', ')}` : '';
}

const minuteText = (m: { minute: number | null; extra: number | null }) =>
  m.minute === null ? null : m.extra ? `${m.minute}+${m.extra}'` : `${m.minute}'`;

function joinList(items: string[], pt: boolean): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${pt ? 'e' : 'y'} ${items.at(-1)}`;
}

function goalsSentence(core: EventCore, goals: RecapGoal[], side: Side, locale: AgentLocale): string | null {
  const pt = languageOf(locale) === 'pt';
  const list = goals.filter((g) => g.team === side);
  if (!list.length) return null;
  // agrupa por autor e tipo, preservando a ordem
  const groups = new Map<string, { scorer: string; type: RecapGoal['type']; minutes: string[] }>();
  for (const g of list) {
    const scorer = g.scorer ?? (pt ? 'autor não informado' : 'autor no informado');
    const key = `${scorer}|${g.type}`;
    const group = groups.get(key) ?? { scorer, type: g.type, minutes: [] };
    const m = minuteText(g);
    if (m) group.minutes.push(m);
    groups.set(key, group);
  }
  const items = [...groups.values()].map((g) => {
    const tag =
      g.type === 'own_goal'
        ? pt
          ? 'contra'
          : 'en contra'
        : g.type === 'penalty'
          ? pt
            ? 'pênalti'
            : 'de penal'
          : null;
    const inside = [tag, joinList(g.minutes, pt)].filter(Boolean).join(', ');
    return inside ? `${g.scorer} (${inside})` : g.scorer;
  });
  const team = teamName(side === 'home' ? core.home : core.away, locale);
  const plural = list.length > 1;
  const head = pt ? `${plural ? 'Gols' : 'Gol'} do ${team}` : `${plural ? 'Goles' : 'Gol'} de ${team}`;
  return `${head}: ${joinList(items, pt)}`;
}

function playersSentence(
  core: EventCore,
  list: RecapPlayerEvent[],
  locale: AgentLocale,
  kind: 'red' | 'missed',
): string | null {
  if (!list.length) return null;
  const pt = languageOf(locale) === 'pt';
  const items = list.map((p) => {
    const team = teamName(p.team === 'home' ? core.home : core.away, locale);
    const who = p.player ?? (pt ? 'jogador não informado' : 'jugador no informado');
    return `${who} (${[team, minuteText(p)].filter(Boolean).join(', ')})`;
  });
  const many = list.length > 1;
  const head =
    kind === 'red'
      ? pt
        ? many
          ? 'Expulsos'
          : 'Expulso'
        : many
          ? 'Expulsados'
          : 'Expulsado'
      : pt
        ? many
          ? 'Pênaltis perdidos'
          : 'Pênalti perdido'
        : many
          ? 'Penales errados'
          : 'Penal errado';
  return `${head}: ${joinList(items, pt)}`;
}

const NEXT_STAGE_TEXT: Record<'pt' | 'es', Record<RecapNextStage, string>> = {
  pt: {
    final: 'a final',
    semi_final: 'as semifinais',
    quarter_final: 'as quartas de final',
    round_of_16: 'as oitavas de final',
    round_of_32: 'a fase de 32 avos',
    round_of_64: 'a fase de 64 avos',
    next_round: 'a próxima fase',
  },
  es: {
    final: 'la final',
    semi_final: 'las semifinales',
    quarter_final: 'los cuartos de final',
    round_of_16: 'los octavos de final',
    round_of_32: 'los dieciseisavos de final',
    round_of_64: 'los treintaidosavos de final',
    next_round: 'la siguiente fase',
  },
};

/** Frase do desfecho do mata-mata (quem passou, agregado e como a vaga saiu); null sem desfecho. */
export function tieSentence(core: EventCore, facts: RecapFacts, locale: AgentLocale): string | null {
  const tie = facts.tie;
  if (!tie) return null;
  const pt = languageOf(locale) === 'pt';
  if (tie.leg === 1)
    return pt
      ? 'Jogo de ida; a vaga será decidida na volta'
      : 'Partido de ida; la serie se define en la vuelta';
  const agg = tie.aggregate;
  const home = teamName(core.home, locale);
  const away = teamName(core.away, locale);
  if (!tie.winner) {
    return agg
      ? pt
        ? `Agregado: ${home} ${agg.home} x ${agg.away} ${away}`
        : `Global: ${home} ${agg.home}-${agg.away} ${away}`
      : null;
  }
  const winner = teamName(tie.winner === 'home' ? core.home : core.away, locale);
  const lang = pt ? 'pt' : 'es';
  const titleNumber = facts.champion_titles?.side === tie.winner ? facts.champion_titles.title_number : null;
  let head =
    tie.outcome === 'title'
      ? titleNumber
        ? `${winner} ${championPhrase(titleNumber, pt ? 'pt' : 'es')}`
        : pt
          ? `${winner} é campeão`
          : `${winner} es campeón`
      : tie.outcome === 'third_place'
        ? pt
          ? `${winner} ficou com o terceiro lugar`
          : `${winner} se quedó con el tercer puesto`
        : pt
          ? `${winner} se classificou para ${NEXT_STAGE_TEXT[lang][tie.next_stage ?? 'next_round']}`
          : `${winner} se clasificó a ${NEXT_STAGE_TEXT[lang][tie.next_stage ?? 'next_round']}`;
  if (tie.legs === 2 && agg) {
    const w = tie.winner === 'home' ? agg.home : agg.away;
    const l = tie.winner === 'home' ? agg.away : agg.home;
    head +=
      tie.decided_by === 'aggregate'
        ? pt
          ? `; venceu o confronto por ${w} x ${l} no agregado`
          : `; ganó la serie ${w}-${l} en el global`
        : tie.decided_by === 'away_goals'
          ? pt
            ? `; o agregado ficou ${w} x ${l} e a vaga saiu pelos gols fora de casa`
            : `; la serie quedó ${w}-${l} en el global y se definió por goles de visitante`
          : pt
            ? `; o agregado ficou ${w} x ${l} e a vaga foi decidida nos pênaltis`
            : `; la serie quedó ${w}-${l} en el global y se definió por penales`;
  }
  return head;
}

/** Resumo determinístico direto da timeline (máx. 4 frases); no mata-mata, o desfecho vem primeiro. */
export function recapFallback(core: EventCore, facts: RecapFacts, locale: AgentLocale): string[] {
  const pt = languageOf(locale) === 'pt';
  const home = teamName(core.home, locale);
  const away = teamName(core.away, locale);
  const { home: h, away: a } = facts.final_score;
  let first = pt
    ? `Fim de jogo: ${home} ${h} x ${a} ${away}`
    : `Final del partido: ${home} ${h}-${a} ${away}`;
  first += flowClause(facts, locale);
  if (facts.decided_by === 'extra_time') first += pt ? ', após a prorrogação' : ', tras el tiempo extra';
  if (facts.penalties) {
    const p = facts.penalties;
    const winner = p.home > p.away ? home : away;
    first += pt
      ? `; nos pênaltis, ${winner} venceu por ${Math.max(p.home, p.away)} x ${Math.min(p.home, p.away)}`
      : `; en los penales, ${winner} ganó ${Math.max(p.home, p.away)}-${Math.min(p.home, p.away)}`;
  }
  const tie = tieSentence(core, facts, locale);
  // desfecho do confronto primeiro (exceto no jogo de ida, que só ganha a nota depois do placar)
  const sentences = tie && facts.tie?.leg !== 1 ? [tie, first] : [first];
  if (tie && facts.tie?.leg === 1) sentences.push(tie);
  // pontos corridos: o que o resultado mudou na tabela, logo depois do placar
  const table = leagueSentence(core, facts, locale);
  if (table) sentences.push(table);
  const goalLines = [
    goalsSentence(core, facts.goals, 'home', locale),
    goalsSentence(core, facts.goals, 'away', locale),
  ];
  if (h + a === 0) sentences.push(pt ? 'Não houve gols' : 'No hubo goles');
  else sentences.push(...goalLines.filter((s): s is string => !!s).slice(0, 4 - sentences.length));
  for (const extra of [
    playersSentence(core, facts.red_cards, locale, 'red'),
    playersSentence(core, facts.missed_penalties, locale, 'missed'),
  ]) {
    if (extra && sentences.length < 4) sentences.push(extra);
  }
  return sentences;
}

export function recapSystemPrompt(): string {
  return [
    'Você é redator esportivo de uma API de dados esportivos para a América Latina.',
    'Tarefa: escrever o RESUMO PÓS-JOGO a partir do placar, da timeline e das estatísticas fornecidos.',
    '',
    'Regras:',
    guardrailSystemRules(),
    '- Para cada locale pedido, escreva de 2 a 4 frases curtas (até 600 caracteres no total).',
    '- Escreva no idioma e na variante regional do locale; não traduza literalmente.',
    "- Comece pelo resultado final. Cite autores de gol e minutos exatamente como na timeline (ex.: 45+2').",
    '- Mata-mata (campo "tie" não nulo): a PRIMEIRA frase é o desfecho do confronto, antes do placar do jogo:',
    '  quem se classificou e para qual fase (tie.outcome = "advances", fase em tie.next_stage) ou quem foi campeão',
    '  (tie.outcome = "title"); em ida e volta, cite o agregado (tie.aggregate) e como a vaga saiu',
    '  (tie.decided_by: aggregate, away_goals, penalties). Ex.: "X se classificou para a final: 2 x 2 no agregado e 5 x 3 nos pênaltis."',
    '- tie.aggregate e tie.first_leg estão na ótica DESTE jogo (home = mandante deste jogo).',
    '- Se tie.leg = 1 (jogo de ida) ou tie.winner = null, NÃO diga que alguém se classificou, foi eliminado ou campeão.',
    '- champion_titles (quando houver): o título conquistado é o de número title_number do campeão naquela competição',
    '  (bi = 2, tri = 3, tetra = 4, penta = 5... deca = 10; 1 = o primeiro). Ex.: "O Palmeiras é tetracampeão da Libertadores."',
    '  Sem champion_titles, não diga quantos títulos o campeão tem.',
    '- Perder o jogo e passar no confronto não é contradição: diga as duas coisas com clareza.',
    '- Pontos corridos (campo "league" não nulo): depois do resultado, diga o que o placar mudou na tabela a partir de',
    '  league.result[].labels (posição, zona, distância para as zonas) e, se couber, o que estava em jogo antes',
    '  (league.before[].labels). Use rank_before/rank_after e points_after exatamente. Não fale de brigas que não',
    '  estão nos fatos (ex.: rebaixamento para um time sem código de rebaixamento).',
    '- "flow" (quando houver): winner_max_deficit > 0 = o vencedor esteve atrás no placar (virada, "de virada" /',
    '  "lo dio vuelta"); came_back_to_draw = o time que buscou o empate. decisive_goal.stoppage_time = true: o gol',
    '  decisivo saiu nos acréscimos; decisive_goal.late = true sem stoppage_time: no fim do jogo (cite o minuto, ex.:',
    '  "aos 90\'"), sem dizer "acréscimos". Sem esses campos, não diga que o jogo foi decidido no fim.',
    '- Estádio: use exatamente match.venue (nome atual); não use nomes antigos.',
    '- Gol contra é creditado ao time beneficiado; diga "contra" (pt) / "en contra" (es) e não chame o jogador de artilheiro.',
    '- Cite times e jogadores exatamente pelos nomes fornecidos. Sem adjetivos de desempenho individual, sem notas e sem opinião.',
  ].join('\n');
}

export function recapUserPrompt(facts: RecapFacts, locales: readonly AgentLocale[]): string {
  return [`Locales: ${locales.join(', ')}`, 'Fatos (JSON):', JSON.stringify(facts)].join('\n');
}
