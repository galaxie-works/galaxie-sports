/**
 * Rótulos fixos da campanha (sem geração livre), no padrão dos stakes: textos por idioma com
 * interpolação de nome do adversário, fase e placar. pt-BR, es (es-AR e variantes) e en.
 * Nomes de clubes vão sem artigo ("contra Chelsea"): o gênero do nome não está na base.
 */
import { pickText } from '../i18n.js';
import type { Campaign, I18nName, TieSummary } from './campaign.js';

type Lang = 'pt' | 'es' | 'en';

interface Dict {
  /** "Na final", "Nas semifinais"... (fase atual). */
  at: Record<string, string>;
  /** "Final", "Semifinal"... (nome da fase como substantivo). */
  noun: Record<string, string>;
  /** Fase sem rótulo fixo (1ª fase, 2ª fase...): `{name}` é o nome da fase. */
  atNamed: string;
  atUnknown: string;
  /** Liga sem posição conhecida (time ainda fora da tabela). */
  leagueOngoing: string;
  leagueFinished: string;
  champion: string;
  runnerUp: string;
  thirdPlace: string;
  fourthPlace: string;
  eliminated: (at: string) => string;
  /** "Eliminou {opp} nas semifinais". */
  beat: (opp: string, at: string) => string;
  against: (stage: string, opp: string) => string;
  /** Confronto em disputa: "Contra {opp}". */
  versus: (opp: string) => string;
  /** Eliminação: "Derrota para {opp}". */
  lostTo: (opp: string) => string;
  place: (n: number) => string;
  finishedAt: (n: number) => string;
  pts: (n: number) => string;
  ptsIn: (pts: number, played: number) => string;
  aggregate: string;
  penalties: string;
  extraTime: string;
  awayGoals: string;
  firstLeg: string;
}

const PT: Dict = {
  at: {
    final: 'Na final',
    semi_final: 'Nas semifinais',
    quarter_final: 'Nas quartas de final',
    round_of_16: 'Nas oitavas de final',
    round_of_32: 'Nos 16 avos de final',
    round_of_64: 'Nos 32 avos de final',
    round_of_128: 'Nos 64 avos de final',
    third_place: 'Na disputa de 3º lugar',
    playoff: 'Nos playoffs',
    qualifying: 'Na fase preliminar',
    group: 'Na fase de grupos',
    league_phase: 'Na fase de liga',
    regular: 'Na primeira fase',
  },
  noun: {
    final: 'Final',
    semi_final: 'Semifinal',
    quarter_final: 'Quartas de final',
    round_of_16: 'Oitavas de final',
    round_of_32: '16 avos de final',
    round_of_64: '32 avos de final',
    round_of_128: '64 avos de final',
    third_place: 'Disputa de 3º lugar',
    playoff: 'Playoff',
    qualifying: 'Fase preliminar',
  },
  atNamed: 'Na {name}',
  atUnknown: 'Classificado para a próxima fase',
  leagueOngoing: 'Em andamento',
  leagueFinished: 'Encerrado',
  champion: 'Campeão',
  runnerUp: 'Vice-campeão',
  thirdPlace: '3º lugar',
  fourthPlace: '4º lugar',
  eliminated: (at) => `Eliminado ${lowerFirst(at)}`,
  beat: (opp, at) => `Eliminou ${opp} ${lowerFirst(at)}`,
  against: (stage, opp) => `${stage} contra ${opp}`,
  versus: (opp) => `Contra ${opp}`,
  lostTo: (opp) => `Derrota para ${opp}`,
  place: (n) => `${n}º lugar`,
  finishedAt: (n) => `Terminou em ${n}º`,
  pts: (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`,
  ptsIn: (p, j) => `${p} ${p === 1 ? 'pt' : 'pts'} em ${j} ${j === 1 ? 'jogo' : 'jogos'}`,
  aggregate: 'no agregado',
  penalties: 'nos pênaltis',
  extraTime: 'na prorrogação',
  awayGoals: 'gols fora',
  firstLeg: 'ida',
};

const ES: Dict = {
  at: {
    final: 'En la final',
    semi_final: 'En semifinales',
    quarter_final: 'En cuartos de final',
    round_of_16: 'En octavos de final',
    round_of_32: 'En dieciseisavos de final',
    round_of_64: 'En 32avos de final',
    round_of_128: 'En 64avos de final',
    third_place: 'En el partido por el 3.er puesto',
    playoff: 'En los playoffs',
    qualifying: 'En la fase previa',
    group: 'En la fase de grupos',
    league_phase: 'En la fase de liga',
    regular: 'En la primera fase',
  },
  noun: {
    final: 'Final',
    semi_final: 'Semifinal',
    quarter_final: 'Cuartos de final',
    round_of_16: 'Octavos de final',
    round_of_32: 'Dieciseisavos de final',
    round_of_64: '32avos de final',
    round_of_128: '64avos de final',
    third_place: 'Partido por el 3.er puesto',
    playoff: 'Playoff',
    qualifying: 'Fase previa',
  },
  atNamed: 'En la {name}',
  atUnknown: 'Clasificado a la siguiente fase',
  leagueOngoing: 'En curso',
  leagueFinished: 'Finalizado',
  champion: 'Campeón',
  runnerUp: 'Subcampeón',
  thirdPlace: '3.er puesto',
  fourthPlace: '4.º puesto',
  eliminated: (at) => `Eliminado ${lowerFirst(at)}`,
  beat: (opp, at) => `Eliminó a ${opp} ${lowerFirst(at)}`,
  against: (stage, opp) => `${stage} contra ${opp}`,
  versus: (opp) => `Contra ${opp}`,
  lostTo: (opp) => `Derrota ante ${opp}`,
  place: (n) => `${n}º puesto`,
  finishedAt: (n) => `Terminó ${n}º`,
  pts: (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`,
  ptsIn: (p, j) => `${p} ${p === 1 ? 'pt' : 'pts'} en ${j} ${j === 1 ? 'partido' : 'partidos'}`,
  aggregate: 'en el global',
  penalties: 'en penales',
  extraTime: 'en el alargue',
  awayGoals: 'goles de visitante',
  firstLeg: 'ida',
};

const EN_ORD = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const EN: Dict = {
  at: {
    final: 'In the final',
    semi_final: 'In the semi-finals',
    quarter_final: 'In the quarter-finals',
    round_of_16: 'In the round of 16',
    round_of_32: 'In the round of 32',
    round_of_64: 'In the round of 64',
    round_of_128: 'In the round of 128',
    third_place: 'In the third-place match',
    playoff: 'In the playoffs',
    qualifying: 'In qualifying',
    group: 'In the group stage',
    league_phase: 'In the league phase',
    regular: 'In the first stage',
  },
  noun: {
    final: 'Final',
    semi_final: 'Semi-final',
    quarter_final: 'Quarter-final',
    round_of_16: 'Round of 16',
    round_of_32: 'Round of 32',
    round_of_64: 'Round of 64',
    round_of_128: 'Round of 128',
    third_place: 'Third-place match',
    playoff: 'Playoff',
    qualifying: 'Qualifying',
  },
  atNamed: 'In the {name}',
  atUnknown: 'Through to the next round',
  leagueOngoing: 'In progress',
  leagueFinished: 'Finished',
  champion: 'Champions',
  runnerUp: 'Runners-up',
  thirdPlace: '3rd place',
  fourthPlace: '4th place',
  eliminated: (at) => `Knocked out ${lowerFirst(at)}`,
  beat: (opp, at) => `Beat ${opp} ${lowerFirst(at)}`,
  against: (stage, opp) => `${stage} vs ${opp}`,
  versus: (opp) => `vs ${opp}`,
  lostTo: (opp) => `Lost to ${opp}`,
  place: (n) => `${EN_ORD(n)} place`,
  finishedAt: (n) => `Finished ${EN_ORD(n)}`,
  pts: (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`,
  ptsIn: (p, j) => `${p} ${p === 1 ? 'pt' : 'pts'} in ${j} ${j === 1 ? 'match' : 'matches'}`,
  aggregate: 'on aggregate',
  penalties: 'on penalties',
  extraTime: 'after extra time',
  awayGoals: 'away goals',
  firstLeg: 'first leg',
};

const DICTS: Record<Lang, Dict> = { pt: PT, es: ES, en: EN };

/** Locales es-* fora da Argentina dizem "tiempo extra", não "alargue". */
function dictFor(locale: string): Dict {
  const lang = locale.split('-')[0]!;
  if (lang === 'es')
    return locale === 'es-AR' || locale === 'es' ? ES : { ...ES, extraTime: 'en tiempo extra' };
  return DICTS[lang as Lang] ?? EN;
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

const name = (n: I18nName, locale: string): string | null =>
  n ? pickText(n as Record<string, string>, locale) : null;

function stageAt(d: Dict, kind: string | null, stageName: string | null): string {
  if (kind && d.at[kind]) return d.at[kind];
  if (stageName) return d.atNamed.replace('{name}', lowerFirst(stageName));
  return d.atUnknown;
}

function stageNoun(d: Dict, kind: string, stageName: string | null): string {
  return d.noun[kind] ?? stageName ?? kind.replace(/_/g, ' ');
}

/** Placar do confronto do ponto de vista do time: "3–1 no agregado", "2–2 no agregado, 5–3 nos pênaltis". */
export function tieScore(t: TieSummary, locale: string): string | null {
  const d = dictFor(locale);
  if (t.playedLegs === 0) return null;
  const score = `${t.goalsFor}–${t.goalsAgainst}`;
  if (t.state === 'pending') return t.legs > 1 ? `${d.firstLeg}: ${score}` : null;
  const parts = [t.legs > 1 ? `${score} ${d.aggregate}` : score];
  if (t.penalties) parts.push(`${t.penalties.for}–${t.penalties.against} ${d.penalties}`);
  else if (t.awayGoals) parts.push(d.awayGoals);
  else if (t.extraTime && t.legs === 1) parts[0] = `${score} ${d.extraTime}`;
  return parts.join(', ');
}

export interface CampaignText {
  label: string;
  detail: string | null;
}

/**
 * Texto da campanha no locale: `label` curto (selo) e `detail` com o confronto decisivo ou a posição.
 * `opponent` é o nome do adversário do confronto em `c.tie`.
 */
export function campaignText(c: Campaign, locale: string, opponent: string | null): CampaignText {
  const d = dictFor(locale);
  const stageName = name(c.stageName, locale);
  const tie = c.tie;
  const tieStage = tie ? stageNoun(d, tie.stageKind, name(tie.stageName, locale)) : null;
  const score = tie ? tieScore(tie, locale) : null;
  const withScore = (s: string) => (score ? `${s} (${score})` : s);
  const tieDetail = tie && opponent ? withScore(d.against(tieStage!, opponent)) : null;
  const tablePos =
    c.rank != null
      ? [d.place(c.rank), c.points != null ? d.pts(c.points) : null].filter(Boolean).join(' · ')
      : null;

  switch (c.status) {
    case 'champion':
      return { label: d.champion, detail: tie ? tieDetail : tablePos };
    case 'runner_up':
      return { label: d.runnerUp, detail: tieDetail };
    case 'third_place':
      return { label: d.thirdPlace, detail: tieDetail };
    case 'eliminated':
      if (c.stageKind === 'third_place') return { label: d.fourthPlace, detail: tieDetail };
      return {
        label: d.eliminated(stageAt(d, c.stageKind, stageName)),
        detail: tie ? (opponent ? withScore(d.lostTo(opponent)) : null) : tablePos,
      };
    case 'in_progress': {
      const label = stageAt(d, c.stageKind, stageName);
      if (!tie) return { label, detail: tablePos };
      if (c.advancedFrom && opponent) {
        const at = stageAt(d, tie.stageKind, name(tie.stageName, locale));
        return { label, detail: withScore(d.beat(opponent, at)) };
      }
      return { label, detail: opponent ? withScore(d.versus(opponent)) : null };
    }
    case 'league':
      return {
        label: c.rank != null ? d.place(c.rank) : d.leagueOngoing,
        detail: c.points != null && c.played != null ? d.ptsIn(c.points, c.played) : null,
      };
    case 'finished_league':
      return {
        label: c.rank != null ? d.finishedAt(c.rank) : d.leagueFinished,
        detail: c.points != null && c.played != null ? d.ptsIn(c.points, c.played) : null,
      };
  }
}
