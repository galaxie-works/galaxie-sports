import {
  FactSheetBuilder,
  guardrailSystemRules,
  languageOf,
  type AgentLocale,
  type FactSheet,
} from '../guardrails/index.js';
import { eventNames, teamName, type EventCore } from '../context/event-core.js';
import type { RecapFacts, RecapGoal, RecapPlayerEvent, Side } from './facts.js';

/**
 * Agente Resumo pós-jogo (issue #58): o LLM redige 2–4 frases por locale a partir da timeline
 * real; o validador confere nomes, minutos e placares; o fallback monta o resumo direto da timeline.
 */

export const RECAP_PROMPT_VERSION = 'recap@v1';

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
  b.number(facts.match.round);
  const goalsBy = { home: 0, away: 0 };
  const perScorer = new Map<string, number>();
  for (const g of facts.goals) {
    b.minute(g.minute, g.extra);
    b.person(g.scorer, { goal: true });
    b.person(g.assist, { goal: true });
    if (g.score_after) b.score(g.score_after.home, g.score_after.away);
    goalsBy[g.team]++;
    if (g.scorer) perScorer.set(g.scorer, (perScorer.get(g.scorer) ?? 0) + 1);
  }
  // contagens citáveis: gols por time e por autor ("marcou dois gols")
  b.number(goalsBy.home, goalsBy.away, ...perScorer.values(), facts.goals.length);
  for (const p of facts.missed_penalties) {
    b.minute(p.minute, p.extra);
    b.person(p.player, { goal: true });
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
  return b.build();
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

/** Resumo determinístico direto da timeline (máx. 4 frases). */
export function recapFallback(core: EventCore, facts: RecapFacts, locale: AgentLocale): string[] {
  const pt = languageOf(locale) === 'pt';
  const home = teamName(core.home, locale);
  const away = teamName(core.away, locale);
  const { home: h, away: a } = facts.final_score;
  let first = pt
    ? `Fim de jogo: ${home} ${h} x ${a} ${away}`
    : `Final del partido: ${home} ${h}-${a} ${away}`;
  if (facts.decided_by === 'extra_time') first += pt ? ', após a prorrogação' : ', tras el tiempo extra';
  if (facts.penalties) {
    const p = facts.penalties;
    const winner = p.home > p.away ? home : away;
    first += pt
      ? `; nos pênaltis, ${winner} venceu por ${Math.max(p.home, p.away)} x ${Math.min(p.home, p.away)}`
      : `; en los penales, ${winner} ganó ${Math.max(p.home, p.away)}-${Math.min(p.home, p.away)}`;
  }
  const sentences = [first];
  const goalLines = [
    goalsSentence(core, facts.goals, 'home', locale),
    goalsSentence(core, facts.goals, 'away', locale),
  ];
  if (h + a === 0) sentences.push(pt ? 'Não houve gols' : 'No hubo goles');
  else sentences.push(...goalLines.filter((s): s is string => !!s));
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
    '- Gol contra é creditado ao time beneficiado; diga "contra" (pt) / "en contra" (es) e não chame o jogador de artilheiro.',
    '- Cite times e jogadores exatamente pelos nomes fornecidos. Sem adjetivos de desempenho individual, sem notas e sem opinião.',
  ].join('\n');
}

export function recapUserPrompt(facts: RecapFacts, locales: readonly AgentLocale[]): string {
  return [`Locales: ${locales.join(', ')}`, 'Fatos (JSON):', JSON.stringify(facts)].join('\n');
}
