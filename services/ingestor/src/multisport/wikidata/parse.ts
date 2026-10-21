import type { MedalType } from '@galaxie/db';
import type { SparqlBinding, SparqlTerm } from './sparql-client.js';

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────────

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
const STATEMENT_PREFIX = 'http://www.wikidata.org/entity/statement/';

/** "http://www.wikidata.org/entity/Q155" → "Q155"; literais, nós em branco e "valor desconhecido" → undefined. */
export function toQid(term: SparqlTerm | undefined): string | undefined {
  if (!term || term.type !== 'uri') return undefined;
  if (!term.value.startsWith(ENTITY_PREFIX) || term.value.startsWith(STATEMENT_PREFIX)) return undefined;
  const id = term.value.slice(ENTITY_PREFIX.length);
  return /^Q\d+$/.test(id) ? id : undefined;
}

function toStatementId(term: SparqlTerm | undefined): string | undefined {
  if (!term || !term.value.startsWith(STATEMENT_PREFIX)) return undefined;
  return term.value.slice(STATEMENT_PREFIX.length);
}

/** Data xsd:dateTime do Wikidata → "YYYY-MM-DD" (ignora datas negativas/imprecisas). */
function toDate(term: SparqlTerm | undefined): string | undefined {
  const m = term?.value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  // precisão de ano/mês vem como -01-01 / -MM-01; mantemos (melhor que nada) — o uso é informativo
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function yearOf(date: string | undefined): number | undefined {
  return date ? Number(date.slice(0, 4)) : undefined;
}

// ─── medalhas ────────────────────────────────────────────────────────────────────────────────────

/** Itens de medalha olímpica no Wikidata. Outros (Pan, genéricos) são mapeados pelo rótulo. */
export const KNOWN_MEDAL_QIDS: Record<string, MedalType> = {
  Q15243387: 'G',
  Q15889641: 'S',
  Q15889643: 'B',
};

/** Ouro/prata/bronze a partir do rótulo em inglês ("Olympic gold medal", "Pan American Games silver medal"...). */
export function medalFromLabel(label: string): MedalType | null {
  const l = label.toLowerCase();
  if (!/medal|champion|place/.test(l)) return null;
  if (/\bgold\b|champion|first place/.test(l)) return 'G';
  if (/\bsilver\b|second place/.test(l)) return 'S';
  if (/\bbronze\b|third place/.test(l)) return 'B';
  return null;
}

const MEDAL_ORDER: Record<MedalType, number> = { G: 0, S: 1, B: 2 };
const bestMedal = (a: MedalType, b: MedalType): MedalType => (MEDAL_ORDER[a] <= MEDAL_ORDER[b] ? a : b);

/** Fases que valem medalha quando a classificação vem por fase (P2443): final e disputa de 3º lugar. */
export const FINAL_STAGE_QIDS = new Set(['Q1366722', 'Q1910276']);

export interface RawStatement {
  id: string;
  eventQid: string;
  participantQid: string;
  medalQids: Set<string>;
  ranks: Set<number>;
  stages: Set<string>;
  deprecated: boolean;
  reasonQids: Set<string>;
  endDate: string | undefined;
  /** País/CON informado na própria declaração (P54 → P17 da delegação, P1532). */
  contextQids: Set<string>;
}

/** Agrupa as linhas (produto dos OPTIONAL) por declaração. */
export function parseMedalStatements(bindings: SparqlBinding[]): RawStatement[] {
  const byId = new Map<string, RawStatement>();
  for (const b of bindings) {
    const id = toStatementId(b.st);
    const eventQid = toQid(b.ev);
    const participantQid = toQid(b.p);
    if (!id || !eventQid || !participantQid) continue;
    let st = byId.get(id);
    if (!st) {
      st = {
        id,
        eventQid,
        participantQid,
        medalQids: new Set(),
        ranks: new Set(),
        stages: new Set(),
        deprecated: false,
        reasonQids: new Set(),
        endDate: undefined,
        contextQids: new Set(),
      };
      byId.set(id, st);
    }
    const medal = toQid(b.medal);
    if (medal) st.medalQids.add(medal);
    if (b.rank && /^-?\d+$/.test(b.rank.value)) st.ranks.add(Number(b.rank.value));
    const stage = toQid(b.stage);
    if (stage) st.stages.add(stage);
    if (b.stRank?.value.endsWith('DeprecatedRank')) st.deprecated = true;
    const why = toQid(b.why);
    if (why) st.reasonQids.add(why);
    st.endDate ??= toDate(b.end);
    for (const k of ['ctx', 'ctxCountry', 'ctxSport'] as const) {
      const q = toQid(b[k]);
      if (q) st.contextQids.add(q);
    }
  }
  return [...byId.values()];
}

export interface StatementMedal {
  medal: MedalType;
  /** true = qualificador P166 (medalha explícita); false = inferida da classificação 1–3 na final. */
  explicit: boolean;
}

/** Interpreta a declaração: medalha explícita (P166) ou classificação 1/2/3 sem fase ou na fase final. */
export function interpretStatement(
  st: RawStatement,
  medalMap: ReadonlyMap<string, MedalType>,
): StatementMedal | null {
  let explicit: MedalType | null = null;
  for (const q of st.medalQids) {
    const m = medalMap.get(q);
    if (m) explicit = explicit ? bestMedal(explicit, m) : m;
  }
  if (explicit) return { medal: explicit, explicit: true };
  const stagesOk = [...st.stages].every((s) => FINAL_STAGE_QIDS.has(s));
  if (!stagesOk || st.ranks.size === 0) return null;
  const rank = Math.min(...st.ranks);
  if (rank === 1) return { medal: 'G', explicit: false };
  if (rank === 2) return { medal: 'S', explicit: false };
  if (rank === 3) return { medal: 'B', explicit: false };
  return null;
}

// ─── provas ──────────────────────────────────────────────────────────────────────────────────────

export interface EventMeta {
  qid: string;
  classes: Set<string>;
  sportLabels: Set<string>;
  parentLabels: Set<string>;
  date: string | undefined;
  labels: { en?: string; pt?: string; es?: string };
}

export function parseEvents(bindings: SparqlBinding[]): Map<string, EventMeta> {
  const out = new Map<string, EventMeta>();
  for (const b of bindings) {
    const qid = toQid(b.ev);
    if (!qid) continue;
    let e = out.get(qid);
    if (!e) {
      e = {
        qid,
        classes: new Set(),
        sportLabels: new Set(),
        parentLabels: new Set(),
        date: undefined,
        labels: {},
      };
      out.set(qid, e);
    }
    const cls = toQid(b.cls);
    if (cls) e.classes.add(cls);
    if (b.sportLabel) e.sportLabels.add(b.sportLabel.value.toLowerCase());
    if (b.parentLabel) e.parentLabels.add(b.parentLabel.value);
    e.date ??= toDate(b.endDate) ?? toDate(b.date) ?? toDate(b.start);
    if (b.lblEn) e.labels.en ??= b.lblEn.value;
    if (b.lblPt) e.labels.pt ??= b.lblPt.value;
    if (b.lblEs) e.labels.es ??= b.lblEs.value;
  }
  return out;
}

/**
 * Classes que indicam etapa/partida/agrupamento (não uma prova que distribui medalhas):
 * quartas, semi, final, eliminatória, grupo, mata-mata, partidas, disputa de 3º lugar, "esporte nos Jogos".
 */
export const NON_MEDAL_EVENT_CLASSES = new Set([
  'Q11564376', // quarter-final
  'Q599999', // semi-final
  'Q1366722', // final
  'Q2122052', // qualification event / heat
  'Q53945096', // group during sports competition
  'Q28089258', // knockout stage
  'Q1910276', // third place playoff
  'Q137424753', // list of participants in sport tournament
  'Q50846264', // international match
  'Q17315159', // international association football match
  'Q16466010', // association football match
  'Q129085076', // international basketball match
  'Q129172778', // international handball match
  'Q129258010', // international field hockey match
  'Q129371708', // international water polo match
  'Q130789417', // volleyball match
  'Q118496986', // sports match
  'Q26132862', // Olympic sports discipline event ("athletics at the 2016 Summer Olympics")
  'Q114609228', // recurring sporting event edition (a própria edição)
  'Q46135307', // nation at sport competition (delegação)
  'Q26213387', // Olympic delegation
]);

const NON_MEDAL_LABEL =
  /\bvs?\.?\s|\bversus\b|\bheats?\b|\bround of\b|repechage|qualif|preliminar|semi-?final|quarter-?final|\bgroup [a-p]\b|\bpool [a-p]\b/i;

/** true quando a prova distribui medalhas (exclui partidas, fases e itens agregadores). */
export function isMedalEvent(meta: EventMeta | undefined): boolean {
  if (!meta) return false;
  for (const c of meta.classes) if (NON_MEDAL_EVENT_CLASSES.has(c)) return false;
  const label = meta.labels.en ?? '';
  return !NON_MEDAL_LABEL.test(label);
}

/** Esporte do evento: P641 ou o prefixo da prova-mãe/rótulo ("athletics at the 2016 Summer Olympics – ..."). */
export function eventSportLabels(meta: EventMeta): string[] {
  const labels = [...meta.sportLabels];
  for (const l of [...meta.parentLabels, meta.labels.en ?? '']) {
    const m = /^(.+?) at the \d{4} /i.exec(l);
    if (m) labels.push(m[1]!.toLowerCase());
  }
  return [...new Set(labels)];
}

/** Gênero da prova pelo rótulo em inglês: W (women/ladies), M (men), X (mixed), O (aberto/indefinido). */
export function eventGenderFromLabel(label: string | undefined): 'M' | 'W' | 'X' | 'O' {
  if (!label) return 'O';
  const l = label.toLowerCase();
  if (/\bmixed\b/.test(l)) return 'X';
  if (/\bwomen'?s?\b|\bladies\b|\bgirls\b/.test(l)) return 'W';
  if (/\bmen'?s?\b|\bboys\b/.test(l)) return 'M';
  return 'O';
}

const TEAM_LABEL =
  /relay|team|doubles|\bpairs?\b|\bduet\b|tournament|synchroni[sz]ed|\b\d\s?[x×]\s?\d|two-man|four-man|two-woman|coxed|coxless|\bsculls\b|\beights?\b|\bfours?\b|\b[kc]-?[24]\b|beach volleyball|madison|team sprint|team pursuit|\bduo\b|\btrios?\b|\bgroup all-around\b|\bteams?\b/i;

/** Dica de prova por equipe pelo rótulo (revezamento, duplas, torneio...). */
export function isTeamEventLabel(label: string | undefined): boolean {
  return !!label && TEAM_LABEL.test(label);
}

// ─── participantes e CON ─────────────────────────────────────────────────────────────────────────

export interface ParticipantMeta {
  qid: string;
  types: Set<string>;
  gender: 'M' | 'F' | 'X' | undefined;
  birthDate: string | undefined;
  countryForSport: { qid: string; start: number | undefined; end: number | undefined }[];
  citizenship: Set<string>;
  country: Set<string>;
  olympediaId: string | undefined;
  labels: { en?: string; pt?: string; es?: string };
}

const HUMAN = 'Q5';

export function isHuman(meta: ParticipantMeta | undefined): boolean {
  return !!meta && meta.types.has(HUMAN);
}

export function parseParticipants(bindings: SparqlBinding[]): Map<string, ParticipantMeta> {
  const out = new Map<string, ParticipantMeta>();
  for (const b of bindings) {
    const qid = toQid(b.p);
    if (!qid) continue;
    let p = out.get(qid);
    if (!p) {
      p = {
        qid,
        types: new Set(),
        gender: undefined,
        birthDate: undefined,
        countryForSport: [],
        citizenship: new Set(),
        country: new Set(),
        olympediaId: undefined,
        labels: {},
      };
      out.set(qid, p);
    }
    const type = toQid(b.type);
    if (type) p.types.add(type);
    const g = toQid(b.gender);
    if (g && !p.gender) p.gender = g === 'Q6581097' ? 'M' : g === 'Q6581072' ? 'F' : 'X';
    p.birthDate ??= toDate(b.birth);
    const cfs = toQid(b.cfs);
    if (cfs) {
      const entry = { qid: cfs, start: yearOf(toDate(b.cfsStart)), end: yearOf(toDate(b.cfsEnd)) };
      if (
        !p.countryForSport.some((c) => c.qid === entry.qid && c.start === entry.start && c.end === entry.end)
      )
        p.countryForSport.push(entry);
    }
    const cit = toQid(b.cit);
    if (cit) p.citizenship.add(cit);
    const country = toQid(b.country);
    if (country) p.country.add(country);
    if (b.olympedia) p.olympediaId ??= b.olympedia.value;
    if (b.lblEn) p.labels.en ??= b.lblEn.value;
    if (b.lblPt) p.labels.pt ??= b.lblPt.value;
    if (b.lblEs) p.labels.es ??= b.lblEs.value;
  }
  return out;
}

/** Mapa QID → códigos COI (P984), a partir de iocCodesQuery. */
export function parseIocCodes(bindings: SparqlBinding[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of bindings) {
    const qid = toQid(b.item);
    const code = b.code?.value.trim().toUpperCase();
    if (!qid || !code || !/^[A-Z0-9]{3}$/.test(code)) continue;
    const list = out.get(qid) ?? [];
    if (!list.includes(code)) list.push(code);
    out.set(qid, list);
  }
  return out;
}

export type NocMethod = 'statement' | 'country_for_sport' | 'country' | 'citizenship';

export interface NocResolution {
  code: string;
  method: NocMethod;
  confidence: number;
}

export interface NocContext {
  iocByQid: ReadonlyMap<string, string[]>;
  knownNocs: ReadonlySet<string>;
}

function codesOf(qids: Iterable<string>, ctx: NocContext): Set<string> {
  const out = new Set<string>();
  for (const q of qids) for (const c of ctx.iocByQid.get(q) ?? []) if (ctx.knownNocs.has(c)) out.add(c);
  return out;
}

/**
 * Resolve o CON de uma medalha, do mais confiável ao menos:
 * 1) país/delegação na própria declaração; 2) "país para o esporte" (P1532) vigente no ano;
 * 3) país do item (equipes, P17); 4) cidadania (P27). Ambiguidades são desfeitas pela interseção com os passos seguintes.
 */
export function resolveNoc(
  contextQids: Iterable<string>,
  meta: ParticipantMeta | undefined,
  year: number,
  ctx: NocContext,
): NocResolution | null {
  const timed = (meta?.countryForSport ?? []).filter(
    (c) => (c.start === undefined || c.start <= year) && (c.end === undefined || c.end >= year),
  );
  const steps: { method: NocMethod; codes: Set<string>; confidence: number }[] = [
    { method: 'statement', codes: codesOf(contextQids, ctx), confidence: 0.95 },
    {
      method: 'country_for_sport',
      codes: codesOf(
        timed.map((c) => c.qid),
        ctx,
      ),
      confidence: 0.9,
    },
    {
      method: 'country_for_sport',
      codes: codesOf(
        (meta?.countryForSport ?? []).map((c) => c.qid),
        ctx,
      ),
      confidence: 0.8,
    },
    { method: 'country', codes: codesOf(meta?.country ?? [], ctx), confidence: 0.85 },
    { method: 'citizenship', codes: codesOf(meta?.citizenship ?? [], ctx), confidence: 0.7 },
  ];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.codes.size === 0) continue;
    if (s.codes.size === 1) return { code: [...s.codes][0]!, method: s.method, confidence: s.confidence };
    for (const later of steps.slice(i + 1)) {
      const inter = [...s.codes].filter((c) => later.codes.has(c));
      if (inter.length === 1) return { code: inter[0]!, method: s.method, confidence: s.confidence - 0.1 };
    }
    return null;
  }
  return null;
}

const USSR_REPUBLICS = new Set([
  'RUS',
  'UKR',
  'BLR',
  'KAZ',
  'UZB',
  'GEO',
  'ARM',
  'AZE',
  'KGZ',
  'TJK',
  'TKM',
  'MDA',
]);
const BALTIC = new Set(['LTU', 'LAT', 'EST']);
const EX_YUGOSLAVIA = new Set(['SRB', 'CRO', 'SLO', 'BIH', 'MKD', 'MNE']);

/**
 * Converte o país atual no código usado pelo COI na época (só Jogos Olímpicos): URS/EUN, TCH/BOH, YUG/SCG,
 * EUA, RU1, OAR/ROC/AIN. Alemanha 1968–1988 (FRG × GDR) não é decidível pelo país atual e fica como GER.
 */
export function historicalNoc(code: string, year: number, season: 'summer' | 'winter'): string {
  if (USSR_REPUBLICS.has(code)) {
    if (year >= 1952 && year <= 1991) return 'URS';
    if (year === 1992) return 'EUN';
  }
  if (BALTIC.has(code) && year >= 1952 && year <= 1991) return 'URS';
  if (code === 'RUS') {
    if (year <= 1912) return 'RU1';
    if (year === 2018 && season === 'winter') return 'OAR';
    if ((year === 2020 && season === 'summer') || (year === 2022 && season === 'winter')) return 'ROC';
    if (year >= 2024) return 'AIN';
  }
  if (code === 'BLR' && year >= 2024) return 'AIN';
  if (code === 'CZE' && year <= 1912) return 'BOH';
  if ((code === 'CZE' || code === 'SVK') && year >= 1920 && year <= 1992) return 'TCH';
  if (EX_YUGOSLAVIA.has(code) && year >= 1920 && year <= 1991) return 'YUG';
  if ((code === 'SRB' || code === 'MNE') && year >= 1994 && year <= 2002) return 'YUG';
  if ((code === 'SRB' || code === 'MNE') && year >= 2004 && year <= 2006) return 'SCG';
  if (code === 'GER' && year >= 1956 && year <= 1964) return 'EUA';
  return code;
}

// ─── montagem das medalhas ───────────────────────────────────────────────────────────────────────

export interface MedalCandidate {
  eventQid: string;
  participantQid: string;
  human: boolean;
  noc: string;
  medal: MedalType;
  explicit: boolean;
  revoked: boolean;
  revokedReason?: string | undefined;
  revokedAt?: string | undefined;
  confidence: number;
  statementIds: string[];
}

export interface BuiltMedal {
  eventQid: string;
  kind: 'athlete' | 'team';
  noc: string;
  medal: MedalType;
  /** Atleta (kind=athlete) ou item da equipe no Wikidata, quando existir. */
  participantQid: string | null;
  personQids: string[];
  revoked: boolean;
  revokedReason: string | undefined;
  revokedAt: string | undefined;
  confidence: number;
  sourceKey: string;
  statementIds: string[];
}

export interface MedalConflict {
  eventQid: string;
  participantQid: string;
  medals: MedalType[];
}

function better(a: MedalCandidate, b: MedalCandidate): MedalCandidate {
  if (a.revoked !== b.revoked) return a.revoked ? b : a;
  if (a.explicit !== b.explicit) return a.explicit ? a : b;
  if (a.medal !== b.medal) return MEDAL_ORDER[a.medal] <= MEDAL_ORDER[b.medal] ? a : b;
  return a.confidence >= b.confidence ? a : b;
}

/**
 * Em prova por equipe, uma mesma cor não se divide entre CONs: atleta com dupla nacionalidade resolvido para
 * outro país (1–2 integrantes) é reatribuído ao CON majoritário da cor (3+ integrantes, ao menos o dobro).
 * Grupos com item de equipe próprio não são mexidos (empates reais, bronzes duplos por equipe).
 */
export function harmonizeTeamNocs(chosen: MedalCandidate[]): MedalCandidate[] {
  const out = chosen.map((c) => ({ ...c }));
  for (const revoked of [false, true])
    for (const colour of ['G', 'S', 'B'] as const) {
      const group = out.filter((c) => c.revoked === revoked && c.medal === colour);
      const counts = new Map<string, number>();
      for (const c of group) if (c.human) counts.set(c.noc, (counts.get(c.noc) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const [major, majorCount] = ranked[0] ?? ['', 0];
      if (majorCount < 3) continue;
      for (const [minor, n] of ranked.slice(1)) {
        if (n > 2 || majorCount < 2 * n) continue;
        if (group.some((c) => c.noc === minor && !c.human)) continue;
        for (const c of group)
          if (c.noc === minor) {
            c.noc = major;
            c.confidence = Math.min(c.confidence, 0.6);
          }
      }
    }
  return out;
}

/**
 * Regras do quadro: 1 medalha por atleta em provas individuais; 1 por CON × cor em provas por equipe
 * (revezamento, duplas, torneios). Prova é "por equipe" se o rótulo indicar, se um participante for uma equipe,
 * ou se 2+ atletas do mesmo CON dividirem a mesma cor. Declaração depreciada (P166 com rank "deprecated")
 * vira medalha revogada, a menos que o mesmo participante tenha declaração válida na prova.
 */
export function buildMedals(
  candidates: MedalCandidate[],
  teamHints: ReadonlyMap<string, boolean>,
): { medals: BuiltMedal[]; teamEvents: Set<string>; conflicts: MedalConflict[] } {
  const byEvent = new Map<string, MedalCandidate[]>();
  for (const c of candidates) {
    const list = byEvent.get(c.eventQid) ?? [];
    list.push(c);
    byEvent.set(c.eventQid, list);
  }

  const medals: BuiltMedal[] = [];
  const teamEvents = new Set<string>();
  const conflicts: MedalConflict[] = [];

  for (const [eventQid, list] of [...byEvent.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const picks = new Map<string, MedalCandidate>();
    const activeMedals = new Map<string, Set<MedalType>>();
    for (const c of list) {
      if (!c.revoked) {
        const set = activeMedals.get(c.participantQid) ?? new Set();
        set.add(c.medal);
        activeMedals.set(c.participantQid, set);
      }
      const prev = picks.get(c.participantQid);
      picks.set(c.participantQid, prev ? better(prev, c) : c);
    }
    for (const [participantQid, set] of activeMedals)
      if (set.size > 1) conflicts.push({ eventQid, participantQid, medals: [...set].sort() });

    let chosen = [...picks.values()];
    const sameColour = new Map<string, number>();
    for (const c of chosen)
      if (!c.revoked && c.human) {
        const k = `${c.noc}:${c.medal}`;
        sameColour.set(k, (sameColour.get(k) ?? 0) + 1);
      }
    const isTeam =
      (teamHints.get(eventQid) ?? false) ||
      chosen.some((c) => !c.human) ||
      [...sameColour.values()].some((n) => n >= 2);
    if (isTeam) {
      teamEvents.add(eventQid);
      chosen = harmonizeTeamNocs(chosen);
    }

    const emit = (group: MedalCandidate[], revoked: boolean) => {
      if (isTeam) {
        const groups = new Map<string, MedalCandidate[]>();
        for (const c of group) {
          const k = `${c.noc}:${c.medal}`;
          groups.set(k, [...(groups.get(k) ?? []), c]);
        }
        for (const [k, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const [noc, medal] = k.split(':') as [string, MedalType];
          const team = g.find((c) => !c.human);
          medals.push({
            eventQid,
            kind: 'team',
            noc,
            medal,
            participantQid: team?.participantQid ?? null,
            personQids: g
              .filter((c) => c.human)
              .map((c) => c.participantQid)
              .sort(),
            revoked,
            revokedReason: revoked ? g[0]!.revokedReason : undefined,
            revokedAt: revoked ? g[0]!.revokedAt : undefined,
            confidence: Math.min(...g.map((c) => c.confidence)),
            sourceKey: `wikidata:${eventQid}:team:${noc}:${medal}${revoked ? ':revoked' : ''}`,
            statementIds: g.flatMap((c) => c.statementIds).sort(),
          });
        }
      } else {
        for (const c of [...group].sort((a, b) => a.participantQid.localeCompare(b.participantQid))) {
          medals.push({
            eventQid,
            kind: 'athlete',
            noc: c.noc,
            medal: c.medal,
            participantQid: c.participantQid,
            personQids: [c.participantQid],
            revoked,
            revokedReason: c.revokedReason,
            revokedAt: c.revokedAt,
            confidence: c.confidence,
            sourceKey: `wikidata:${eventQid}:athlete:${c.participantQid}:${c.medal}${revoked ? ':revoked' : ''}`,
            statementIds: [...c.statementIds].sort(),
          });
        }
      }
    };
    emit(
      chosen.filter((c) => !c.revoked),
      false,
    );
    emit(
      chosen.filter((c) => c.revoked),
      true,
    );
  }
  return { medals, teamEvents, conflicts };
}
