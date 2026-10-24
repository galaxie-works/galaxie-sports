import { escapeRegExp, languageOf, normalizeText, splitSentences } from './text.js';

/**
 * Validador factual determinístico (docs/07 §2.3): todo número, placar, minuto e nome próprio
 * citado no texto gerado precisa existir nos fatos fornecidos ao LLM. É heurístico e conservador —
 * na dúvida, reprova (o agente tenta de novo uma vez e depois cai no texto determinístico).
 */

export interface FactMinute {
  minute: number;
  extra: number | null;
}

export interface FactSheet {
  /** Números citáveis (placares, minutos, margens, rodada, pontos, posições...). */
  numbers: readonly number[];
  /** Placares citáveis ("2 a 1", "2x1", "2-1"); a ordem dos lados é indiferente. */
  scores: readonly (readonly [number, number])[];
  /**
   * Placares que podem aparecer como resultado (frases com verbo de resultado: venceu, empatou,
   * terminou...). Ausente = não checa (ex.: cenário pré-jogo).
   */
  resultScores?: readonly (readonly [number, number])[];
  /** Nomes próprios citáveis (times, pessoas, estádio, competição, fase, zonas, rótulos fixos). */
  names: readonly string[];
  /** Pessoas citáveis (subconjunto de `names`), usadas pela regra de autoria de gol. */
  people?: readonly string[];
  /** Pessoas envolvidas em gols (autor, assistência, gol contra, pênalti perdido). */
  goalPeople?: readonly string[];
  /** Minutos citáveis (resumo). Ausente = minutos só são checados como números. */
  minutes?: readonly FactMinute[];
}

export const FACT_VIOLATION_KINDS = [
  'unknown_number',
  'unknown_score',
  'wrong_result',
  'unknown_name',
  'unknown_minute',
  'wrong_scorer',
] as const;
export type FactViolationKind = (typeof FACT_VIOLATION_KINDS)[number];

export interface FactViolation {
  kind: FactViolationKind;
  /** Valor encontrado no texto (número, placar, nome...). */
  value: string;
  sentence: string;
}

// ─── vocabulário ─────────────────────────────────────────────────────────────────────────────────

/** Números por extenso (sem "um/uma/un/una/uno", que são artigos; sem "dos" em pt, que é contração). */
const NUMBER_WORDS: Record<'pt' | 'es', Record<string, number>> = {
  pt: {
    zero: 0,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    catorze: 14,
    quatorze: 14,
    quinze: 15,
    vinte: 20,
    trinta: 30,
  },
  es: {
    cero: 0,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    veinte: 20,
    treinta: 30,
  },
};

/** Conectores que unem partes de um nome próprio ("Vasco da Gama", "Atlético de Madrid"). */
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'del', 'la', 'las', 'los', 'di', 'van', 'von']);

/**
 * Palavras que podem aparecer com inicial maiúscula sem serem nomes próprios (início de frase,
 * siglas comuns). Normalizadas (sem acento).
 */
const STOPWORDS: Record<'pt' | 'es', ReadonlySet<string>> = {
  pt: new Set(
    (
      'o a os as um uma uns umas de do da dos das no na nos nas num numa em com sem por pela pelo pelas pelos ' +
      'para pra e ou mas que se ja ainda nao sim mesmo tambem so apenas depois antes agora hoje amanha ontem ' +
      'aqui ali la entao assim porem contudo enquanto quando onde como caso isso isto esse essa este esta ' +
      'aquele aquela ele ela eles elas seu sua seus suas qualquer cada todo toda todos todas outro outra ambos ' +
      'ambas nem quem qual quais ate apos desde sobre entre contra durante segundo segunda primeiro primeira ' +
      'terceiro terceira ultimo ultima final semifinal vitoria vitorias empate empates derrota derrotas jogo ' +
      'jogos partida partidas gol gols placar classificacao vaga rodada turno returno ida volta mandante ' +
      'visitante time times equipe equipes casa fora tempo tempos intervalo inicio fim penaltis penalti ' +
      'prorrogacao decisao disputa campeonato copa taca liga fase grupo grupos tabela lider lideranca ' +
      'rebaixamento acesso titulo zona pontos ponto saldo agregado confronto duelo cartao cartoes amarelo ' +
      'vermelho expulsao var vence venceu vencer vencendo ganhou ganha ganhar empata empatou empatar perde ' +
      'perdeu perder precisa precisam pode podem basta avanca avancam garante garantem leva levou decide ' +
      'decidem fica ficou segue seguem chega chegou entra entrou abre abriu fecha fechou marcou fez nesta ' +
      'neste nessa nesse naquela naquele com mais menos muito pouco bem mal sao foi era sera tem teve ha ' +
      'houve gol-contra fim-de-jogo resultado classificado classificada eliminado eliminada campeao ' +
      'rebaixado rebaixada destaque destaques estatisticas posse chutes finalizacoes expulso expulsos ' +
      'fim'
    ).split(/\s+/),
  ),
  es: new Set(
    (
      'el la los las un una unos unas uno de del al en con sin por para y e o u pero que si ya aun todavia ' +
      'no mismo tambien solo despues antes ahora hoy manana ayer aqui alli entonces asi mientras cuando donde ' +
      'como eso esto ese esa este esta aquel aquella el ella ellos ellas su sus cualquier cada todo toda ' +
      'todos todas otro otra ambos ni quien cual hasta tras desde sobre entre contra durante segundo segunda ' +
      'primero primera tercero tercera ultimo ultima final semifinal victoria victorias triunfo empate ' +
      'empates derrota derrotas partido partidos encuentro gol goles marcador clasificacion cupo fecha ' +
      'jornada ida vuelta local visitante equipo equipos casa tiempo tiempos entretiempo descanso inicio ' +
      'penales penal alargue prorroga extra suplementario definicion serie llave campeonato copa liga torneo ' +
      'fase grupo grupos tabla lider descenso ascenso titulo zona puntos punto diferencia global tarjeta ' +
      'tarjetas amarilla roja expulsion var gana gano ganar gane empata empato empatar pierde perdio perder ' +
      'necesita necesitan puede pueden basta avanza avanzan asegura aseguran lleva llevo define definen ' +
      'sigue siguen llega llego abre abrio cierra cerro marco hizo con mas menos muy poco bien mal es fue era ' +
      'sera tiene tuvo hay hubo le les lo se resultado clasificado clasificada eliminado eliminada campeon ' +
      'descendido destacado estadisticas posesion remates tiros expulsado expulsados fin'
    ).split(/\s+/),
  ),
};

const RESULT_VERBS: Record<'pt' | 'es', RegExp> = {
  pt: /\b(venceu|vence|ganhou|derrotou|bateu|goleou|empatou|perdeu|terminou|acabou|placar final|resultado final|fim de jogo)\b/,
  es: /\b(gano|vencio|derroto|supero|goleo|empato|perdio|termino|finalizo|cayo|resultado final|marcador final|final del partido)\b/,
};
/** Frases sobre outro recorte do jogo (intervalo, ida, agregado) não são o resultado final. */
const PARTIAL_CONTEXT =
  /\b(intervalo|primeiro tempo|primer tiempo|entretiempo|descanso|ida|agregado|global|parcial)\b/;

const GOAL_VERBS: Record<'pt' | 'es', RegExp> = {
  pt: /\b(marc(ou|a|ar|ando)|fez (o|os|um|dois|tres) gols?|anotou|balancou|abriu o placar|ampliou|descontou|virou|converteu|gol de|gols de|assistencia|gol contra|cabecada)\b/,
  es: /\b(marco|marca|anoto|convirtio|abrio el marcador|amplio|desconto|igualo|gol de|goles de|asistencia|gol en contra|de cabeza|de penal)\b/,
};

// ─── extração ────────────────────────────────────────────────────────────────────────────────────

const WORD_RE = /[\p{L}\p{M}\d][\p{L}\p{M}\d'’.-]*/gu;

function cleanToken(token: string): string {
  return token.replace(/[.'’-]+$/u, '');
}

function tokensOf(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map(cleanToken).map(normalizeText).filter(Boolean);
}

function isCapitalized(token: string): boolean {
  return /^\p{Lu}/u.test(token);
}

/** Sequências de palavras com inicial maiúscula (com conectores internos) por frase. */
function nameRuns(sentence: string, lang: 'pt' | 'es'): string[][] {
  const runs: string[][] = [];
  const words: { text: string; start: number }[] = [];
  for (const m of sentence.matchAll(WORD_RE)) words.push({ text: cleanToken(m[0]), start: m.index });
  const sentenceInitial = (start: number) => {
    const before = sentence.slice(0, start).trimEnd();
    return before === '' || /[.!?:;"«(—–]$/u.test(before);
  };
  let current: string[] = [];
  let currentInitial = false;
  const flush = () => {
    while (current.length && CONNECTORS.has(normalizeText(current.at(-1)!))) current.pop();
    if (currentInitial) {
      while (current.length && STOPWORDS[lang].has(normalizeText(current[0]!))) current.shift();
    }
    // Siglas e palavras comuns isoladas (VAR, Gols:) também saem.
    if (current.length && current.every((t) => STOPWORDS[lang].has(normalizeText(t)))) current = [];
    if (current.length) runs.push(current);
    current = [];
    currentInitial = false;
  };
  words.forEach((w, i) => {
    const cap = isCapitalized(w.text);
    if (cap) {
      const initial = sentenceInitial(w.start);
      if (current.length && initial) flush();
      if (!current.length) currentInitial = initial;
      current.push(w.text);
      return;
    }
    const next = words[i + 1];
    if (current.length && CONNECTORS.has(normalizeText(w.text)) && next && isCapitalized(next.text)) {
      current.push(w.text);
      return;
    }
    flush();
  });
  flush();
  return runs;
}

function isSubsequence(candidate: readonly string[], allowed: readonly string[]): boolean {
  if (candidate.length === 0 || candidate.length > allowed.length) return false;
  outer: for (let i = 0; i + candidate.length <= allowed.length; i++) {
    for (let j = 0; j < candidate.length; j++) if (allowed[i + j] !== candidate[j]) continue outer;
    return true;
  }
  return false;
}

/** Remove os nomes permitidos do texto normalizado (para não ler números de dentro de nomes). */
function stripNames(normalized: string, names: readonly string[]): string {
  let out = ` ${normalized} `;
  const sorted = [...new Set(names.map(normalizeText).filter((n) => n.length > 1))].sort(
    (a, b) => b.length - a.length,
  );
  for (const n of sorted) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(n)}(?![\\p{L}\\d])`, 'gu'), ' ');
  }
  return out;
}

function hasPair(list: readonly (readonly [number, number])[] | undefined, a: number, b: number): boolean {
  return (list ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

const SCORE_RE =
  /(?<![\d:+]|\d[.,])(\d{1,2})\s*(?:a|x|×|-|–|—)\s*(\d{1,2})(?![\d:%'′+]|[.,]\d|\s*(?:min|minutos?)\b)/g;
const MINUTE_RE =
  /(?<![\d,.+])(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*(?:'|′|min\b|minutos?\b)|(?<![\d,.+])(\d{1,3})\s*\+\s*(\d{1,2})(?!\d)|\b(?:aos|a los)\s+(\d{1,3})(?:\s*\+\s*(\d{1,2}))?(?![\d+])(?!\s*(?:a|x|-)\s*\d)/g;
const NUMBER_RE = /(?<![\d])(\d+(?:[.,]\d+)?)(?!\d)/g;
/**
 * Ordinais de título ("tetracampeão", "penta", "bicampeonato", "tetracampeón"): valem como número (4, 5, 2...).
 * Só o prefixo sozinho ou seguido de "campe...", para não pegar "tricolor".
 */
const TITLE_ORDINALS: Record<string, number> = {
  bi: 2,
  tri: 3,
  tetra: 4,
  penta: 5,
  hexa: 6,
  hepta: 7,
  octa: 8,
  enea: 9,
  deca: 10,
};
const TITLE_ORDINAL_RE = /(?<![a-z])(bi|tri|tetra|penta|hexa|hepta|octa|enea|deca)(?:campe[a-z]*)?(?![a-z])/g;

// ─── validação ───────────────────────────────────────────────────────────────────────────────────

/** Confere o texto contra os fatos. Lista vazia = nenhuma divergência encontrada. */
export function checkFacts(text: string, facts: FactSheet, locale: string): FactViolation[] {
  const lang = languageOf(locale);
  const out: FactViolation[] = [];
  const numbers = new Set(facts.numbers);
  const allowedTokens = facts.names.map(tokensOf).filter((t) => t.length > 0);
  const people = (facts.people ?? []).map(normalizeText).filter(Boolean);
  const goalPeople = new Set((facts.goalPeople ?? []).map(normalizeText));

  const nameAllowed = (tokens: string[]): boolean => {
    const norm = tokens.map(normalizeText);
    if (norm.every((t) => STOPWORDS[lang].has(t))) return true;
    return allowedTokens.some((a) => isSubsequence(norm, a));
  };

  for (const sentence of splitSentences(text)) {
    const normalized = normalizeText(sentence);
    const stripped = stripNames(normalized, facts.names);

    // nomes próprios
    for (const run of nameRuns(sentence, lang)) {
      if (nameAllowed(run)) continue;
      // tenta as partes separadas pelos conectores ("Palmeiras de Abel" → "Palmeiras", "Abel")
      const parts: string[][] = [[]];
      for (const t of run) {
        if (CONNECTORS.has(normalizeText(t))) parts.push([]);
        else parts.at(-1)!.push(t);
      }
      for (const part of parts.filter((p) => p.length)) {
        if (!nameAllowed(part)) out.push({ kind: 'unknown_name', value: part.join(' '), sentence });
      }
    }

    // placares
    const scorePairs: [number, number][] = [];
    for (const m of stripped.matchAll(SCORE_RE)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      scorePairs.push([a, b]);
      if (!hasPair(facts.scores, a, b)) out.push({ kind: 'unknown_score', value: `${a}-${b}`, sentence });
    }
    if (facts.resultScores && RESULT_VERBS[lang].test(normalized) && !PARTIAL_CONTEXT.test(normalized)) {
      for (const [a, b] of scorePairs) {
        if (hasPair(facts.scores, a, b) && !hasPair(facts.resultScores, a, b))
          out.push({ kind: 'wrong_result', value: `${a}-${b}`, sentence });
      }
    }

    // minutos
    if (facts.minutes) {
      for (const m of stripped.matchAll(MINUTE_RE)) {
        const minute = Number(m[1] ?? m[3] ?? m[5]);
        const extraRaw = m[2] ?? m[4] ?? m[6];
        const extra = extraRaw === undefined ? null : Number(extraRaw);
        const ok = facts.minutes.some(
          (f) =>
            (f.minute === minute && (extra === null || f.extra === extra)) ||
            (extra === null && f.extra !== null && f.minute + f.extra === minute),
        );
        if (!ok)
          out.push({
            kind: 'unknown_minute',
            value: extra === null ? `${minute}'` : `${minute}+${extra}'`,
            sentence,
          });
      }
    }

    // números (algarismos e por extenso)
    for (const m of stripped.matchAll(NUMBER_RE)) {
      const value = Number(m[1]!.replace(',', '.'));
      if (!numbers.has(value)) out.push({ kind: 'unknown_number', value: m[1]!, sentence });
    }
    for (const m of stripped.matchAll(TITLE_ORDINAL_RE)) {
      if (!numbers.has(TITLE_ORDINALS[m[1]!]!)) out.push({ kind: 'unknown_number', value: m[0], sentence });
    }
    for (const [word, value] of Object.entries(NUMBER_WORDS[lang])) {
      if (new RegExp(`(?<![a-z])${word}(?![a-z])`).test(stripped) && !numbers.has(value))
        out.push({ kind: 'unknown_number', value: word, sentence });
    }

    // autoria de gol: em frase sobre gol, toda pessoa citada precisa ter participado de um gol
    if (facts.goalPeople && GOAL_VERBS[lang].test(normalized)) {
      for (const p of people) {
        if (goalPeople.has(p)) continue;
        if (new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(p)}(?![\\p{L}\\d])`, 'u').test(normalized))
          out.push({ kind: 'wrong_scorer', value: p, sentence });
      }
    }
  }
  return dedupe(out);
}

function dedupe(list: FactViolation[]): FactViolation[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const key = `${v.kind}|${v.value}|${v.sentence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Acumula números e placares para montar um `FactSheet` sem repetição. */
export class FactSheetBuilder {
  private readonly numbers = new Set<number>();
  private readonly scores: [number, number][] = [];
  private readonly resultScores: [number, number][] = [];
  private readonly names = new Set<string>();
  private readonly people = new Set<string>();
  private readonly goalPeople = new Set<string>();
  private readonly minutes: FactMinute[] = [];
  private withResults = false;
  private withMinutes = false;
  private withGoals = false;

  number(...values: (number | null | undefined)[]): this {
    for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) this.numbers.add(v);
    return this;
  }

  score(a: number | null | undefined, b: number | null | undefined, opts: { result?: boolean } = {}): this {
    if (typeof a !== 'number' || typeof b !== 'number') return this;
    this.number(a, b);
    if (!hasPair(this.scores, a, b)) this.scores.push([a, b]);
    if (opts.result) {
      this.withResults = true;
      if (!hasPair(this.resultScores, a, b)) this.resultScores.push([a, b]);
    }
    return this;
  }

  /** Liga a regra de resultado mesmo sem placar marcado (ex.: só o placar final). */
  expectResults(): this {
    this.withResults = true;
    return this;
  }

  name(...values: (string | null | undefined)[]): this {
    for (const v of values) if (v && v.trim()) this.names.add(v.trim());
    return this;
  }

  person(name: string | null | undefined, opts: { goal?: boolean } = {}): this {
    if (!name || !name.trim()) return this;
    this.name(name);
    this.people.add(name.trim());
    if (opts.goal) this.goalPeople.add(name.trim());
    return this;
  }

  /** Liga a regra de autoria de gol. */
  expectGoals(): this {
    this.withGoals = true;
    return this;
  }

  minute(minute: number | null | undefined, extra: number | null | undefined): this {
    this.withMinutes = true;
    if (typeof minute !== 'number') return this;
    this.number(minute, extra);
    if (typeof extra === 'number') this.number(minute + extra);
    this.minutes.push({ minute, extra: typeof extra === 'number' ? extra : null });
    return this;
  }

  build(): FactSheet {
    const sheet: FactSheet = {
      numbers: [...this.numbers],
      scores: this.scores,
      names: [...this.names],
      people: [...this.people],
    };
    if (this.withResults) sheet.resultScores = this.resultScores;
    if (this.withMinutes) sheet.minutes = this.minutes;
    if (this.withGoals) sheet.goalPeople = [...this.goalPeople];
    return sheet;
  }
}
