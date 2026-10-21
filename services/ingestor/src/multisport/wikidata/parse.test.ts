import { describe, expect, it } from 'vitest';
import type { MedalType } from '@galaxie/db';
import { BRONZE, date, FINAL, GOLD, lit, SEMI, SILVER, statementRow, uri } from './fixtures.js';
import {
  buildMedals,
  eventGenderFromLabel,
  eventSportLabels,
  harmonizeTeamNocs,
  historicalNoc,
  interpretStatement,
  isMedalEvent,
  isTeamEventLabel,
  KNOWN_MEDAL_QIDS,
  medalFromLabel,
  parseEvents,
  parseIocCodes,
  parseMedalStatements,
  parseParticipants,
  resolveNoc,
  toQid,
  type EventMeta,
  type MedalCandidate,
  type ParticipantMeta,
} from './parse.js';

const medalMap = new Map<string, MedalType>(Object.entries(KNOWN_MEDAL_QIDS));

describe('parseMedalStatements', () => {
  it('agrupa as linhas do produto de OPTIONAL por declaração', () => {
    const rows = [
      statementRow({
        id: 'Q1189-a',
        ev: 'Q100',
        p: 'Q1189',
        rank: 1,
        stage: FINAL,
        medal: GOLD,
        ctxSport: 'Q766',
      }),
      statementRow({
        id: 'Q1189-a',
        ev: 'Q100',
        p: 'Q1189',
        rank: 1,
        stage: FINAL,
        ctx: 'Q900',
        ctxCountry: 'Q766',
      }),
      statementRow({ id: 'Q1189-b', ev: 'Q100', p: 'Q1189', rank: 1, stage: SEMI }),
      // valor desconhecido (nó em branco) é ignorado
      { ...statementRow({ id: 'Q5-x', ev: 'Q100', p: 'Q1' }), p: { type: 'bnode' as const, value: 't1' } },
    ];
    const st = parseMedalStatements(rows);
    expect(st).toHaveLength(2);
    const a = st.find((s) => s.id === 'Q1189-a')!;
    expect([...a.medalQids]).toEqual([GOLD]);
    expect([...a.contextQids].sort()).toEqual(['Q766', 'Q900']);
    expect(a.deprecated).toBe(false);
  });

  it('marca declarações depreciadas e guarda o motivo', () => {
    const [s] = parseMedalStatements([
      statementRow({ id: 'Q9-a', ev: 'Q100', p: 'Q9', medal: SILVER, deprecated: true, why: 'Q1234' }),
    ]);
    expect(s!.deprecated).toBe(true);
    expect([...s!.reasonQids]).toEqual(['Q1234']);
  });
});

describe('interpretStatement', () => {
  const parse = (spec: Parameters<typeof statementRow>[0]) =>
    interpretStatement(parseMedalStatements([statementRow(spec)])[0]!, medalMap);

  it('usa a medalha explícita (P166) mesmo sem classificação', () => {
    expect(parse({ id: 's1', ev: 'Q1', p: 'Q2', medal: BRONZE })).toEqual({ medal: 'B', explicit: true });
  });

  it('infere a medalha da classificação 1–3 sem fase ou na final', () => {
    expect(parse({ id: 's1', ev: 'Q1', p: 'Q2', rank: 2 })).toEqual({ medal: 'S', explicit: false });
    expect(parse({ id: 's1', ev: 'Q1', p: 'Q2', rank: 1, stage: FINAL })).toEqual({
      medal: 'G',
      explicit: false,
    });
  });

  it('ignora vitória em eliminatória/semifinal e classificação fora do pódio', () => {
    expect(parse({ id: 's1', ev: 'Q1', p: 'Q2', rank: 1, stage: SEMI })).toBeNull();
    expect(parse({ id: 's1', ev: 'Q1', p: 'Q2', rank: 4 })).toBeNull();
  });
});

describe('medalFromLabel / toQid', () => {
  it('reconhece medalhas pelo rótulo', () => {
    expect(medalFromLabel('Pan American Games gold medal')).toBe('G');
    expect(medalFromLabel('Olympic silver medal')).toBe('S');
    expect(medalFromLabel('bronze medal')).toBe('B');
    expect(medalFromLabel('Order of Merit')).toBeNull();
  });

  it('extrai QIDs só de entidades', () => {
    expect(toQid(uri('Q155'))).toBe('Q155');
    expect(toQid(lit('Q155'))).toBeUndefined();
    expect(toQid({ type: 'uri', value: 'http://www.wikidata.org/entity/statement/Q1-abc' })).toBeUndefined();
  });
});

describe('provas', () => {
  const meta = (en: string, classes: string[] = [], extra: Partial<EventMeta> = {}): EventMeta => ({
    qid: 'Q1',
    classes: new Set(classes),
    sportLabels: new Set(),
    parentLabels: new Set(),
    date: undefined,
    labels: { en },
    ...extra,
  });

  it('exclui partidas, fases e itens agregadores', () => {
    expect(
      isMedalEvent(meta("athletics at the 2016 Summer Olympics – men's 100 metres", ['Q18536594'])),
    ).toBe(true);
    expect(isMedalEvent(meta('Brazil vs Germany', ['Q17315159']))).toBe(false);
    expect(isMedalEvent(meta('athletics at the 2016 Summer Olympics', ['Q26132862']))).toBe(false);
    expect(isMedalEvent(meta("men's 100 metres – heat 3"))).toBe(false);
    expect(isMedalEvent(undefined)).toBe(false);
  });

  it('deduz esporte, gênero e se é por equipe', () => {
    const m = meta("swimming at the 2016 Summer Olympics – women's 4 × 100 metre freestyle relay", [], {
      parentLabels: new Set(['swimming at the 2016 Summer Olympics']),
    });
    expect(eventSportLabels(m)).toEqual(['swimming']);
    expect(eventGenderFromLabel(m.labels.en)).toBe('W');
    expect(eventGenderFromLabel('judo at the 2020 Summer Olympics – mixed team')).toBe('X');
    expect(eventGenderFromLabel("boxing at the 2016 Summer Olympics – men's lightweight")).toBe('M');
    expect(isTeamEventLabel(m.labels.en)).toBe(true);
    expect(isTeamEventLabel("football at the 2016 Summer Olympics – men's tournament")).toBe(true);
    expect(isTeamEventLabel("judo at the 2016 Summer Olympics – women's 57 kg")).toBe(false);
  });

  it('lê metadados das provas', () => {
    const events = parseEvents([
      {
        ev: uri('Q1'),
        cls: uri('Q18536594'),
        sportLabel: lit('Athletics', 'en'),
        endDate: date('2016-08-14'),
        lblEn: lit("men's 100 metres", 'en'),
        lblPt: lit('100 metros masculino', 'pt-br'),
      },
      { ev: uri('Q1'), cls: uri('Q11783626') },
    ]);
    const e = events.get('Q1')!;
    expect([...e.classes]).toEqual(['Q18536594', 'Q11783626']);
    expect(e.sportLabels.has('athletics')).toBe(true);
    expect(e.date).toBe('2016-08-14');
    expect(e.labels).toEqual({ en: "men's 100 metres", pt: '100 metros masculino' });
  });
});

describe('resolveNoc', () => {
  const ioc = new Map([
    ['Q155', ['BRA']],
    ['Q38', ['ITA']],
    ['Q766', ['JAM']],
    ['Q15180', ['URS']],
    ['Q159', ['RUS']],
  ]);
  const ctx = { iocByQid: ioc, knownNocs: new Set(['BRA', 'ITA', 'JAM', 'URS', 'RUS']) };
  const person = (p: Partial<ParticipantMeta>): ParticipantMeta => ({
    qid: 'Q1',
    types: new Set(['Q5']),
    gender: undefined,
    birthDate: undefined,
    countryForSport: [],
    citizenship: new Set(),
    country: new Set(),
    olympediaId: undefined,
    labels: {},
    ...p,
  });

  it('prioriza o país informado na própria declaração', () => {
    const p = person({ citizenship: new Set(['Q38']) });
    expect(resolveNoc(['Q155'], p, 2016, ctx)).toEqual({
      code: 'BRA',
      method: 'statement',
      confidence: 0.95,
    });
  });

  it('usa o país esportivo vigente no ano', () => {
    const p = person({
      countryForSport: [
        { qid: 'Q15180', start: 1972, end: 1991 },
        { qid: 'Q159', start: 1992, end: undefined },
      ],
    });
    expect(resolveNoc([], p, 1980, ctx)?.code).toBe('URS');
    expect(resolveNoc([], p, 1996, ctx)?.code).toBe('RUS');
  });

  it('desfaz dupla cidadania pela interseção com o país esportivo', () => {
    const p = person({
      countryForSport: [{ qid: 'Q155', start: undefined, end: undefined }],
      citizenship: new Set(['Q155', 'Q38']),
    });
    expect(resolveNoc([], p, 2016, ctx)?.code).toBe('BRA');
    const ambiguous = person({ citizenship: new Set(['Q155', 'Q38']) });
    expect(resolveNoc([], ambiguous, 2016, ctx)).toBeNull();
    expect(resolveNoc([], undefined, 2016, ctx)).toBeNull();
  });

  it('lê os códigos COI (P984) e participantes', () => {
    const map = parseIocCodes([
      { item: uri('Q155'), code: lit('BRA') },
      { item: uri('Q155'), code: lit('bra') },
      { item: uri('Q1'), code: lit('invalid') },
    ]);
    expect(map.get('Q155')).toEqual(['BRA']);
    expect(map.has('Q1')).toBe(false);
    const parts = parseParticipants([
      {
        p: uri('Q7'),
        type: uri('Q5'),
        gender: uri('Q6581072'),
        cfs: uri('Q155'),
        cfsStart: date('2010-01-01'),
        cit: uri('Q155'),
        lblEn: lit('Rafaela Silva', 'en'),
      },
    ]);
    expect(parts.get('Q7')).toMatchObject({ gender: 'F', countryForSport: [{ qid: 'Q155', start: 2010 }] });
  });
});

describe('historicalNoc', () => {
  it('converte o país atual no código usado na época', () => {
    expect(historicalNoc('UKR', 1980, 'summer')).toBe('URS');
    expect(historicalNoc('RUS', 1992, 'winter')).toBe('EUN');
    expect(historicalNoc('RUS', 2018, 'winter')).toBe('OAR');
    expect(historicalNoc('RUS', 2020, 'summer')).toBe('ROC');
    expect(historicalNoc('RUS', 2024, 'summer')).toBe('AIN');
    expect(historicalNoc('CZE', 1988, 'summer')).toBe('TCH');
    expect(historicalNoc('CRO', 1984, 'winter')).toBe('YUG');
    expect(historicalNoc('SRB', 2004, 'summer')).toBe('SCG');
    expect(historicalNoc('GER', 1960, 'summer')).toBe('EUA');
    expect(historicalNoc('BRA', 1980, 'summer')).toBe('BRA');
  });
});

describe('buildMedals', () => {
  const c = (
    over: Partial<MedalCandidate> & Pick<MedalCandidate, 'eventQid' | 'participantQid'>,
  ): MedalCandidate => ({
    human: true,
    noc: 'BRA',
    medal: 'G',
    explicit: true,
    revoked: false,
    confidence: 0.9,
    statementIds: [`${over.participantQid}-s`],
    ...over,
  });

  it('prova individual: uma medalha por atleta, dois bronzes na luta e empate no ouro', () => {
    const { medals, teamEvents } = buildMedals(
      [
        c({ eventQid: 'Q1', participantQid: 'Q11', noc: 'BRA', medal: 'G' }),
        c({ eventQid: 'Q1', participantQid: 'Q12', noc: 'MGL', medal: 'S' }),
        c({ eventQid: 'Q1', participantQid: 'Q13', noc: 'JPN', medal: 'B' }),
        c({ eventQid: 'Q1', participantQid: 'Q14', noc: 'POR', medal: 'B' }),
        // empate no ouro (natação): dois ouros de CONs diferentes
        c({ eventQid: 'Q2', participantQid: 'Q21', noc: 'USA', medal: 'G' }),
        c({ eventQid: 'Q2', participantQid: 'Q22', noc: 'CAN', medal: 'G' }),
      ],
      new Map(),
    );
    expect(teamEvents.size).toBe(0);
    expect(medals.filter((m) => m.eventQid === 'Q1').map((m) => m.medal)).toEqual(['G', 'S', 'B', 'B']);
    expect(medals.filter((m) => m.eventQid === 'Q2' && m.medal === 'G')).toHaveLength(2);
    expect(medals[0]!.sourceKey).toBe('wikidata:Q1:athlete:Q11:G');
  });

  it('prova por equipe: uma medalha por CON e cor, com os integrantes', () => {
    const { medals, teamEvents } = buildMedals(
      [
        c({ eventQid: 'Q3', participantQid: 'Q31', noc: 'BRA', medal: 'G' }),
        c({ eventQid: 'Q3', participantQid: 'Q32', noc: 'BRA', medal: 'G' }),
        c({ eventQid: 'Q3', participantQid: 'Q33', noc: 'ITA', medal: 'S' }),
      ],
      new Map(),
    );
    expect(teamEvents.has('Q3')).toBe(true);
    expect(medals).toHaveLength(2);
    expect(medals[0]).toMatchObject({ kind: 'team', noc: 'BRA', medal: 'G', personQids: ['Q31', 'Q32'] });
    expect(medals[0]!.sourceKey).toBe('wikidata:Q3:team:BRA:G');
  });

  it('participante que é um item de equipe torna a prova coletiva', () => {
    const { medals } = buildMedals(
      [c({ eventQid: 'Q4', participantQid: 'Q41', human: false, noc: 'BRA' })],
      new Map(),
    );
    expect(medals[0]).toMatchObject({ kind: 'team', participantQid: 'Q41', personQids: [] });
  });

  it('declaração depreciada vira medalha revogada, salvo se houver declaração válida', () => {
    const { medals, conflicts } = buildMedals(
      [
        c({
          eventQid: 'Q5',
          participantQid: 'Q51',
          noc: 'RUS',
          medal: 'G',
          revoked: true,
          revokedReason: 'doping',
        }),
        c({ eventQid: 'Q5', participantQid: 'Q52', noc: 'BRA', medal: 'S', revoked: true }),
        c({ eventQid: 'Q5', participantQid: 'Q52', noc: 'BRA', medal: 'G' }),
        c({ eventQid: 'Q6', participantQid: 'Q61', medal: 'S', explicit: false }),
        c({ eventQid: 'Q6', participantQid: 'Q61', medal: 'B', explicit: false }),
      ],
      new Map(),
    );
    const q5 = medals.filter((m) => m.eventQid === 'Q5');
    expect(q5.map((m) => [m.participantQid, m.medal, m.revoked])).toEqual([
      ['Q52', 'G', false],
      ['Q51', 'G', true],
    ]);
    expect(q5[1]!.sourceKey).toBe('wikidata:Q5:athlete:Q51:G:revoked');
    expect(conflicts).toEqual([{ eventQid: 'Q6', participantQid: 'Q61', medals: ['B', 'S'] }]);
    expect(medals.find((m) => m.eventQid === 'Q6')!.medal).toBe('S');
  });

  it('em prova coletiva, integrante com dupla nacionalidade volta ao CON majoritário', () => {
    const base = ['Q71', 'Q72', 'Q73'].map((p) =>
      c({ eventQid: 'Q7', participantQid: p, noc: 'SRB', medal: 'G' }),
    );
    const stray = c({ eventQid: 'Q7', participantQid: 'Q74', noc: 'MNE', medal: 'G' });
    const fixed = harmonizeTeamNocs([...base, stray]);
    expect(fixed.every((x) => x.noc === 'SRB')).toBe(true);
    const { medals } = buildMedals([...base, stray], new Map([['Q7', true]]));
    expect(medals).toHaveLength(1);
    expect(medals[0]!.personQids).toHaveLength(4);
  });
});
