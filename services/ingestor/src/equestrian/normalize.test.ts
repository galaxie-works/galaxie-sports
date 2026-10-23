import { describe, expect, it } from 'vitest';
import { normalizePackage, type PackageTables } from './normalize.js';
import {
  articleCode,
  displayName,
  horseGender,
  int,
  isoDate,
  judging,
  num,
  stars,
  statusFromPosition,
  text,
} from './parse.js';

describe('parse', () => {
  it('converte só o que é explícito (ausente não é zero)', () => {
    expect(num('22,500')).toBe(22500);
    expect(num('5.93')).toBe(5.93);
    expect(num('')).toBeNull();
    expect(num('EL')).toBeNull();
    expect(int('60')).toBe(60);
    expect(int('60=')).toBeNull();
    expect(int(null)).toBeNull();
    expect(text('EL CAMPEON&#39;S CIRKA Z')).toBe("EL CAMPEON'S CIRKA Z");
    expect(text('A &amp; B')).toBe('A & B');
  });

  it('datas publicadas', () => {
    expect(isoDate('04/10/2026 15:30')).toBe('2026-10-04');
    expect(isoDate('2004-08-19')).toBe('2004-08-19');
    expect(isoDate('30/12/2005 21 year(s)')).toBe('2005-12-30');
    expect(isoDate('31/13/2005')).toBeNull();
    expect(isoDate('31/02/2026')).toBeNull();
    expect(isoDate('2026-13-40')).toBeNull();
    expect(isoDate('2024-02-29')).toBe('2024-02-29');
    expect(isoDate('')).toBeNull();
  });

  it('status, nível e julgamento', () => {
    expect(statusFromPosition('1')).toBe('classified');
    expect(statusFromPosition('RET')).toBe('RET');
    expect(statusFromPosition('7', 'classified')).toBe('classified');
    expect(statusFromPosition(null, 'EL')).toBe('EL');
    expect(statusFromPosition('?')).toBe('unknown');
    expect(stars('CSIO4*-W')).toBe(4);
    expect(stars('Olympic Games-S')).toBeNull();
    expect(articleCode('220.2.1.2-GP - Table A, one round')).toBe('220.2.1.2');
    expect(
      judging('220.2.1.2-GP - Table A, one round against the clock with one jump-off against the clock'),
    ).toBe('jump_off');
    expect(judging('222.2.3 - "Special two-phase". First phase Table A')).toBe('two_phases');
    expect(judging('221.4.3(i)-GP - 2 rounds Table A')).toBe('two_rounds');
    expect(judging('220.2.1.1 - Table A, one round against the clock')).toBe('faults_time');
    expect(judging('Hist - Historical Rule')).toBe('historical');
  });

  it('nomes de exibição', () => {
    expect(displayName('WERTHEIN, Lucas')).toBe('Lucas Werthein');
    expect(displayName('Karl COOK (USA)')).toBe('Karl Cook');
    expect(displayName('Rodrigo Pessoa')).toBe('Rodrigo Pessoa');
    expect(displayName('DE LA FUENTE, Juan')).toBe('Juan de la Fuente');
  });

  it('gênero do cavalo', () => {
    expect(horseGender('Female', 'Unknown')).toBe('mare');
    expect(horseGender('Male', 'Yes')).toBe('gelding');
    expect(horseGender('Male', 'No')).toBe('stallion');
    expect(horseGender('Male', null)).toBe('male');
    expect(horseGender(null, null)).toBeNull();
  });
});

/** Campeonato usado nos exemplos (chave de rodadas e equipes). */
const ATHENS = 'athens_2004_jumping';

/** Pacote mínimo com as mesmas colunas do SQLite V3. */
function fixture(): PackageTables {
  const base = 'https://data.fei.org';
  return {
    athletes: [
      {
        athlete_fei_id: '10000380',
        athlete_name: 'WERTHEIN, Lucas',
        represented_country_current: 'ARG',
        performance_url: `${base}/Person/Performance.aspx?personFEIID=10000380`,
        displayed_total: '2 Competition(s) / 1 Page(s)',
        collected_jumping_results: 2,
        verified_all_displayed_pages: 1,
      },
      {
        athlete_fei_id: '10000999',
        athlete_name: 'PARCIAL, Ana',
        represented_country_current: 'BRA',
        collected_jumping_results: 0,
        verified_all_displayed_pages: 0,
      },
    ],
    athlete_profiles: [
      {
        athlete_fei_id: '10000380',
        first_name: 'Lucas',
        family_name: 'WERTHEIN',
        birth_date_raw: '07/10/1985',
      },
      { athlete_fei_id: '10000999', first_name: 'Ana', family_name: 'PARCIAL', birth_date_raw: null },
    ],
    horses: [
      {
        horse_fei_id: 'NED04702',
        horse_name: 'WARREN',
        profile_status: 'public_detail_observed',
        birth_date_iso_as_published: '1994-01-01',
        gender: 'Male',
        castrated: 'Yes',
        breed: 'KWPN',
        profile_source_url: `${base}/Horse/Detail.aspx?horsefeiid=NED04702`,
      },
    ],
    competitions: [
      {
        competition_id: 'c-athens',
        name: 'Final Classification',
        event_category_raw: 'Olympic Games-S',
        date_raw: '19/08/2004',
        venue_raw: 'Athens',
        event_country: 'GRE',
        article: 'Hist',
        all_entries_observed: 0,
      },
      {
        competition_id: 'c-gp',
        name: 'Grand Prix',
        event_category_raw: 'CSI2*',
        date_raw: '17/10/2026 15:30',
        venue_raw: 'Woodside CA',
        event_country: 'USA',
        height_cm_raw: '145',
        article:
          '220.2.1.2-GP - Table A, one round against the clock with one jump-off against the clock (Grand Prix)',
        total_prize_amount_decimal: '75000',
        prize_currency: 'USD',
        displayed_entries: 2,
        observed_entries: 2,
        all_entries_observed: 1,
      },
    ],
    results: [
      {
        result_id: 'r-athens',
        athlete_fei_id: '10000380',
        athlete_name: 'WERTHEIN, Lucas',
        represented_country_current: 'ARG',
        date_iso: '2004-08-19',
        horse_fei_id: 'NED04702',
        horse_name: 'WARREN',
        position_raw: '71',
        position: 71,
        status: 'classified',
        score_raw: null,
        score_parse_status: 'missing',
        quality_flags: 'missing_score',
      },
      {
        result_id: 'r-gp',
        athlete_fei_id: '10000999',
        athlete_name: 'PARCIAL, Ana',
        represented_country_current: 'BRA',
        date_iso: '2026-10-17',
        horse_fei_id: 'BRA00001',
        horse_name: 'CAVALO PENDENTE',
        position_raw: '2',
        position: 2,
        status: 'classified',
        score_raw: '5(4+1)/78.15',
        score_parse_status: 'explicit_single_round',
        penalties_round1: 5,
        time_round1_seconds: 78.15,
        quality_flags: 'ok',
      },
    ],
    result_entities: [
      { result_id: 'r-athens', competition_id: 'c-athens', horse_fei_id: 'NED04702' },
      { result_id: 'r-gp', competition_id: 'c-gp', horse_fei_id: 'BRA00001' },
    ],
    score_parts: [
      {
        result_id: 'r-gp',
        sequence: 1,
        raw: '5(4+1)',
        kind: 'explicit_penalties',
        numeric_value: null,
        penalties_total: 5,
        penalties_jumping: 4,
        penalties_time: 1,
      },
      { result_id: 'r-gp', sequence: 2, raw: '78.15', kind: 'numeric_unassigned', numeric_value: 78.15 },
    ],
    competition_entries: [
      {
        entry_id: 'e-1',
        competition_id: 'c-gp',
        athlete_fei_id: '10030760',
        athlete_name_as_published: 'Karl COOK (USA)',
        country_as_published: 'USA',
        horse_fei_id: '107OZ38',
        horse_name_as_published: 'HEROES KERVEC',
        position_raw: '1',
        prize_amount_decimal: '22500',
        prize_currency: 'USD',
        prize_raw: '22,500 USD',
      },
      {
        // mesma classificação já vista no histórico da atleta: não pode duplicar
        entry_id: 'e-2',
        competition_id: 'c-gp',
        athlete_fei_id: '10000999',
        athlete_name_as_published: 'Ana PARCIAL (BRA)',
        country_as_published: 'BRA',
        horse_fei_id: 'BRA00001',
        horse_name_as_published: 'CAVALO PENDENTE',
        position_raw: '2',
        prize_amount_decimal: '15000',
        prize_currency: 'USD',
        prize_raw: '15,000 USD',
      },
    ],
    round_details: [
      {
        entry_id: 'e-2',
        column_index: 8,
        round_header: 'Round 1\nFaults',
        cells_json: '[["4","1"]]',
        interpretation_status: 'raw',
      },
    ],
    championship_classifications: [
      {
        classification_observation_id: 'cc-1',
        event_key: ATHENS,
        event: 'Olympic Games-S',
        date_iso_as_published: '2004-08-19',
        competition: 'Final Classification',
        athlete_fei_id: '10000380',
        athlete_name_as_published: 'Lucas WERTHEIN (ARG)',
        country_as_published: 'ARG',
        position_raw: '71',
        existing_base_result_id: 'r-athens',
      },
      {
        classification_observation_id: 'cc-2',
        event_key: ATHENS,
        event: 'Olympic Games-S',
        date_iso_as_published: '2004-08-19',
        competition: 'Final Classification',
        athlete_fei_id: '10000435',
        athlete_name_as_published: 'Rodrigo PESSOA (BRA)',
        country_as_published: 'BRA',
        horse_fei_id: 'BEL05011',
        horse_name_as_published: 'BALOUBET DU ROUET',
        position_raw: '1',
      },
    ],
    official_round_observations: [
      {
        round_observation_id: 'ro-1',
        event_key: ATHENS,
        stage: 'qualifier_2',
        date_iso: '2004-08-24',
        athlete_fei_id: '10000380',
        athlete_name: 'Lucas WERTHEIN',
        horse_fei_id: 'NED04702',
        horse_name: 'WARREN',
        penalties_jumping: null,
        penalties_time: null,
        penalties_total: null,
        status: 'EL',
        source_pdf_page: 99,
      },
    ],
    source_disagreements: [
      {
        disagreement_id: 'd-1',
        athlete_fei_id: '10000435',
        event_key: ATHENS,
        field: 'individual_final_rank',
        fei_value: '21',
        official_report_value: '23',
        official_report_pdf_page: 116,
        resolution: 'unresolved_preserved_as_distinct_source_observations',
      },
    ],
  };
}

describe('normalizePackage', () => {
  const n = normalizePackage(fixture());

  it('cobertura do histórico por atleta', () => {
    const lucas = n.athletes.find((a) => a.feiId === '10000380')!;
    expect(lucas.displayName).toBe('Lucas Werthein');
    expect(lucas.historyCoverage).toBe('complete');
    expect(lucas.birthDate).toBe('1985-10-07');
    expect(n.athletes.find((a) => a.feiId === '10000999')!.historyCoverage).toBe('partial');
    // conhecido só por classificação
    expect(n.athletes.find((a) => a.feiId === '10000435')!.historyCoverage).toBe('not_collected');
  });

  it('a mesma classificação vista em duas páginas vira uma linha, com o prêmio da lista completa', () => {
    const inGp = n.results.filter((r) => r.competitionKey === 'c-gp');
    expect(inGp).toHaveLength(2);
    const ana = inGp.find((r) => r.athleteFeiId === '10000999')!;
    expect(ana.sourceKind).toBe('athlete_performance_history');
    expect(ana.prizeAmount).toBe(15000);
    expect(ana.roundCells).toHaveLength(1);
    expect(ana.penalties).toBe(5);
    expect(ana.penaltiesJumping).toBe(4);
    expect(ana.penaltiesTime).toBe(1);
    expect(ana.timeSeconds).toBe(78.15);
  });

  it('ausente não vira zero', () => {
    const athens = n.results.find((r) => r.sourceKey === 'r-athens')!;
    expect(athens.scoreRaw).toBeNull();
    expect(athens.penalties).toBeNull();
    expect(athens.timeSeconds).toBeNull();
    expect(athens.qualityFlags).toEqual(['missing_score']);
    const elim = n.rounds.find((r) => r.sourceKey === 'ro-1')!;
    expect(elim.status).toBe('EL');
    expect(elim.score).toBeNull();
    expect(elim.penaltiesJumping).toBeNull();
  });

  it('classificação de campeonato usa a prova do histórico e não duplica o conjunto já registrado', () => {
    const athens = n.results.filter((r) => r.competitionKey === 'c-athens');
    expect(athens.map((r) => r.athleteFeiId).sort()).toEqual(['10000380', '10000435']);
    expect(n.competitions.find((c) => c.sourceKey === 'c-athens')!.showKey).toBe(ATHENS);
  });

  it('rodada é registro separado da classificação geral', () => {
    expect(n.rounds).toHaveLength(1);
    expect(n.results.some((r) => r.sourceKey === 'ro-1')).toBe(false);
  });

  it('cavalo sem ficha entra como pendente; ficha detalhada preserva os campos', () => {
    expect(n.horses.find((h) => h.feiId === 'BRA00001')!.profileStatus).toBe('pending');
    const warren = n.horses.find((h) => h.feiId === 'NED04702')!;
    expect(warren.profileStatus).toBe('detailed');
    expect(warren.gender).toBe('gelding');
    expect(warren.breed).toBe('KWPN');
  });

  it('divergências preservam os dois valores com a fonte', () => {
    expect(n.disagreements[0]!.values.map((v) => v.value)).toEqual(['21', '23']);
    expect(n.disagreements[0]!.values[1]!.page).toBe(116);
  });

  it('prova com classificação completa e julgamento derivado do artigo', () => {
    const gp = n.competitions.find((c) => c.sourceKey === 'c-gp')!;
    expect(gp.allEntriesObserved).toBe(true);
    expect(gp.judging).toBe('jump_off');
    expect(gp.isGrandPrix).toBe(true);
    expect(gp.heightCm).toBe(145);
    expect(gp.prizeTotal).toBe(75000);
  });
});
