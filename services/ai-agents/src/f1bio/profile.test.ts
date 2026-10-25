import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  buildKnowledgeBase,
  DEFAULT_KNOWLEDGE_DIR,
  loadKnowledge,
  parseKnowledgeFile,
  type KnowledgeBase,
} from '@galaxie/knowledge';
import { FakeLlmClient } from '../llm/fake.js';
import { applyProfiles, editorialFile } from './apply-profile.js';
import type { ProfileFacts } from './profile-facts.js';
import { mergeProfiles, profileFactSheet, proposeProfile, resolveRival } from './profile.js';
import { checkFacts } from '../guardrails/index.js';

const race = (
  key: string,
  gp: string,
  circuit: string,
  grid: number,
  finish: number | null,
  date: string,
) => {
  const [year, round] = key.split('-').map(Number) as [number, number];
  return { key, year, round, gp, circuit, grid, finish, status: finish == null ? 'DNF' : null, date };
};

const senna: ProfileFacts = {
  f1dbId: 'ayrton-senna',
  name: 'Ayrton Senna',
  country: 'BR',
  abbreviation: 'SEN',
  seasons: { first: 1984, last: 1994 },
  teams: ['Toleman', 'Lotus', 'McLaren', 'Williams'],
  titles: [1988, 1990, 1991],
  wins: 41,
  races: 161,
  tier: 'legend',
  birthDate: '1960-03-21',
  poles: 65,
  podiums: 80,
  points: 614,
  seasonStats: [
    { year: 1984, position: 9, points: 13, wins: 0, podiums: 3 },
    { year: 1988, position: 1, points: 90, wins: 8, podiums: 11 },
    { year: 1991, position: 1, points: 96, wins: 7, podiums: 12 },
    { year: 1993, position: 2, points: 73, wins: 5, podiums: 7 },
  ],
  circuits: [{ name: 'Circuit de Monaco', races: 10, wins: 6, podiums: 8 }],
  racesList: [
    race('1984-06', 'Monaco Grand Prix', 'Circuit de Monaco', 13, 2, '1984-06-03'),
    race('1988-04', 'Monaco Grand Prix', 'Circuit de Monaco', 1, null, '1988-05-15'),
    race('1991-02', 'Brazilian Grand Prix', 'Autódromo José Carlos Pace', 1, 1, '1991-03-24'),
    race('1993-03', 'European Grand Prix', 'Donington Park', 4, 1, '1993-04-11'),
  ],
  teammates: [
    { name: 'Gerhard Berger', races: 48 },
    { name: 'Alain Prost', races: 32 },
  ],
  contemporaries: [
    { f1dbId: 'alain-prost', name: 'Alain Prost' },
    { f1dbId: 'nigel-mansell', name: 'Nigel Mansell' },
    { f1dbId: 'gerhard-berger', name: 'Gerhard Berger' },
  ],
};

const WIKI = 'https://pt.wikipedia.org/wiki/Ayrton_Senna';
const F1 = 'https://www.formula1.com/en/information/ayrton-senna';
const GE = 'https://ge.globo.com/motor/formula-1/noticia/senna-donington.ghtml';

const research = {
  data: {
    bio: {
      text:
        'Ayrton Senna disputou 161 GPs entre 1984 e 1994 e venceu 41 deles, com 65 poles e três títulos mundiais (1988, 1990 e 1991).\n\n' +
        'Fez da volta de classificação uma assinatura e da chuva, um palco.\n\n' +
        'Em Donington, em 1993, saiu da quarta posição e liderou já na primeira volta.',
      sources: [WIKI, F1, 'https://exemplo.invalido/senna'],
    },
    style: {
      kind: 'aggressive',
      text: 'Atacava cada curva no limite, em busca do milésimo na volta lançada.',
      sources: [WIKI],
    },
    strengths: [
      { key: 'wet_weather', text: 'Brilhou sob chuva, como em Donington em 1993.', source: GE },
      { key: 'qualifying', text: 'Fez 65 poles na carreira.', source: F1 },
      { key: 'qualifying', text: 'Repetido: a pole era a especialidade.', source: F1 },
      { key: 'race_intelligence', text: 'Sem fonte da busca.', source: 'https://blog.qualquer/senna' },
    ],
    moments: [
      {
        race_key: '1993-03',
        race: 'GP da Europa',
        wet: true,
        text: 'Saiu da quarta posição e liderou já na primeira volta, sob chuva em Donington.',
        source: GE,
      },
      {
        race_key: '1991-02',
        race: 'GP do Brasil',
        wet: false,
        text: 'Venceu em casa pela primeira vez, com o câmbio travado na sexta marcha no fim.',
        source: WIKI,
      },
      {
        race_key: '1984-06',
        race: 'GP de Mônaco',
        wet: true,
        text: 'Com a Toleman, chegou em segundo e escalou o pelotão sob chuva.',
        source: WIKI,
      },
      {
        race_key: '1990-15',
        race: 'GP do Japão',
        wet: false,
        text: 'Corrida que não está na lista do piloto.',
        source: WIKI,
      },
      {
        race_key: '1988-04',
        race: 'GP de Mônaco',
        wet: false,
        text: 'Liderava com 42 segundos de vantagem quando bateu.',
        source: WIKI,
      },
    ],
    rivalries: [
      {
        driver: 'Alain Prost',
        text: 'Companheiro na McLaren, foi o grande rival do fim dos anos 1980.',
        source: WIKI,
      },
      { driver: 'Fulano de Tal', text: 'Rival que não está no F1DB.', source: WIKI },
    ],
  },
  groundedUrls: [WIKI, F1, GE],
};

const translation = {
  data: {
    bio: 'Ayrton Senna disputó 161 GP entre 1984 y 1994 y ganó 41 de ellos, con 65 poles y tres títulos mundiales (1988, 1990 y 1991).\n\nHizo de la vuelta de clasificación una firma y de la lluvia, un escenario.',
    style: 'Atacaba cada curva al límite, en busca de la milésima en la vuelta lanzada.',
    strengths: ['Brilló bajo la lluvia, como en Donington en 1993.', 'Logró 65 poles en su carrera.'],
    moments: [
      { race: 'GP de Mónaco', text: 'Con Toleman, llegó segundo y escaló el pelotón bajo la lluvia.' },
      { race: 'GP de Brasil', text: 'Ganó en casa por primera vez, con la caja trabada en sexta al final.' },
      {
        race: 'GP de Europa',
        text: 'Salió cuarto y lideró ya en la primera vuelta, bajo la lluvia en Donington.',
      },
    ],
    rivalries: ['Compañero en McLaren, fue el gran rival de fines de los años 1980.'],
  },
};

describe('profileFactSheet', () => {
  it('números do F1DB passam; número fora dele é apontado', () => {
    const sheet = profileFactSheet(senna);
    const unknown = (t: string) =>
      checkFacts(t, sheet, 'pt-BR')
        .filter((v) => v.kind === 'unknown_number')
        .map((v) => v.value);
    expect(
      unknown('Três títulos (1988, 1990 e 1991), 41 vitórias e 65 poles; nasceu em 21 de março de 1960.'),
    ).toEqual([]);
    expect(unknown('Somou 42 vitórias e 66 poles.')).toEqual(['42', '66']);
  });
});

describe('proposeProfile (lenda)', () => {
  it('cada item com fonte da busca, número do F1DB e corrida da lista; o resto cai com o motivo', async () => {
    const llm = new FakeLlmClient([research, translation]);
    const p = await proposeProfile(llm, senna);
    expect(p.status).toBe('accepted');
    const pt = p.entries['pt-BR']!;
    expect(pt.bio.sources).toEqual([WIKI, F1]);
    expect(pt.style?.kind).toBe('aggressive');
    expect(pt.strengths?.map((s) => s.key)).toEqual(['wet_weather', 'qualifying']);
    // em ordem cronológica, com ano e rodada da lista do F1DB
    expect(pt.moments?.map((m) => [m.year, m.round, m.wet ?? false])).toEqual([
      [1984, 6, true],
      [1991, 2, false],
      [1993, 3, true],
    ]);
    expect(pt.rivalries?.map((r) => r.driver)).toEqual([{ f1db_id: 'alain-prost', name: 'Alain Prost' }]);
    expect(p.dropped.map((d) => d.reason)).toEqual(
      expect.arrayContaining([
        'fonte não veio da busca',
        'ponto forte repetido',
        'corrida fora da lista do piloto (1990-15)',
        'número fora do F1DB (42)',
        'rival fora do F1DB (Fulano de Tal)',
      ]),
    );
    expect(llm.calls[0]).toMatchObject({ tier: 'research', webSearch: true });
    expect(llm.calls[1]).toMatchObject({ tier: 'standard' });
    expect(llm.calls[1]!.webSearch).toBeFalsy();
  });

  it('a tradução es mantém as fontes e os vínculos, item a item', async () => {
    const p = await proposeProfile(new FakeLlmClient([research, translation]), senna);
    const es = p.entries.es!;
    expect(es.bio.text).toMatch(/^Ayrton Senna disputó/);
    expect(es.bio.sources).toEqual(p.entries['pt-BR']!.bio.sources);
    expect(es.moments?.map((m) => [m.year, m.round, m.race, m.source])).toEqual([
      [1984, 6, 'GP de Mónaco', WIKI],
      [1991, 2, 'GP de Brasil', WIKI],
      [1993, 3, 'GP de Europa', GE],
    ]);
    expect(es.rivalries?.[0]!.driver.f1db_id).toBe('alain-prost');
  });

  it('bio com número fora do F1DB: sem proposta (nada inventado entra)', async () => {
    const wrong = {
      ...research,
      data: {
        ...research.data,
        bio: { ...research.data.bio, text: 'Ayrton Senna venceu 42 GPs e fez 66 poles na Fórmula 1.' },
      },
    };
    const p = await proposeProfile(new FakeLlmClient([wrong]), senna);
    expect(p.status).toBe('rejected');
    expect(p.reasons).toEqual(['bio recusada: número fora do F1DB (42, 66)']);
    expect(p.entries).toEqual({ 'pt-BR': null, es: null });
  });

  it('lenda sem nenhum momento verificável: sem proposta', async () => {
    const none = { ...research, data: { ...research.data, moments: [] } };
    const p = await proposeProfile(new FakeLlmClient([none]), senna);
    expect(p.status).toBe('rejected');
    expect(p.reasons).toContain('lenda sem nenhum momento com fonte verificável');
  });
});

describe('proposeProfile (regular)', () => {
  it('só a bio curta, com o schema enxuto', async () => {
    const regular: ProfileFacts = {
      ...senna,
      tier: 'regular',
      f1dbId: 'rubens-barrichello',
      name: 'Rubens Barrichello',
    };
    const llm = new FakeLlmClient([
      {
        data: { bio: { text: 'Disputou 161 GPs e venceu 41 deles, com 65 poles.', sources: [WIKI] } },
        groundedUrls: [WIKI],
      },
      {
        data: {
          bio: 'Disputó 161 GP y ganó 41 de ellos, con 65 poles.',
          style: null,
          strengths: [],
          moments: [],
          rivalries: [],
        },
      },
    ]);
    const p = await proposeProfile(llm, regular);
    expect(p.status).toBe('accepted');
    expect(p.entries['pt-BR']).toEqual({
      slug: 'f1-rubens-barrichello',
      name: 'Rubens Barrichello',
      f1db: { id: 'rubens-barrichello' },
      tier: 'regular',
      bio: { text: 'Disputou 161 GPs e venceu 41 deles, com 65 poles.', sources: [WIKI] },
      review_status: 'draft',
    });
    expect(p.entries.es?.bio.text).toMatch(/^Disputó/);
    expect(llm.calls[0]!.schemaName).toBe('f1_driver_short_bio');
  });
});

describe('resolveRival', () => {
  it('nome completo ou sobrenome único entre quem largou nas mesmas corridas', () => {
    expect(resolveRival('Prost', senna)?.f1dbId).toBe('alain-prost');
    expect(resolveRival('Nigel Mansell', senna)?.f1dbId).toBe('nigel-mansell');
    expect(resolveRival('Michael Schumacher', senna)).toBeNull();
  });
});

describe('applyProfiles', () => {
  const withFile = (kb: KnowledgeBase, rel: string, text: string) =>
    buildKnowledgeBase(kb.dir, [
      ...kb.files.filter((f) => f.rel !== rel),
      parseKnowledgeFile(join(kb.dir, rel), rel, text),
    ]);

  it('grava o original e a tradução como draft e passa no validador; aplicar de novo não muda nada', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const p = await proposeProfile(new FakeLlmClient([research, translation]), senna);
    const first = await applyProfiles(kb, [p]);
    expect(first.applied).toEqual(['pt-BR:ayrton-senna', 'es:ayrton-senna']);
    const pt = parse(first.files.find((f) => f.rel === editorialFile('pt-BR'))!.text) as {
      drivers: Record<string, unknown>[];
    };
    expect(pt.drivers.find((d) => d.slug === 'f1-ayrton-senna')).toMatchObject({
      f1db: { id: 'ayrton-senna' },
      tier: 'legend',
      review_status: 'draft',
    });
    let after = kb;
    for (const f of first.files) after = withFile(after, f.rel, f.text);
    const second = await applyProfiles(after, [p]);
    expect(second.files).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toEqual(['já está igual no YAML', 'já está igual no YAML']);
  });

  it('nunca sobrescreve um perfil aprovado', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const p = await proposeProfile(new FakeLlmClient([research, translation]), senna);
    const first = await applyProfiles(kb, [p]);
    const approved = first.files[0]!.text.replace('review_status: draft', 'review_status: approved');
    const changes = await applyProfiles(withFile(kb, editorialFile('pt-BR'), approved), [p]);
    expect(changes.skipped[0]).toEqual({
      f1dbId: 'ayrton-senna',
      locale: 'pt-BR',
      reason: 'perfil já aprovado: não é sobrescrito',
    });
  });
});

describe('propostas de várias execuções (passo da VPS)', () => {
  it('a nova substitui a do mesmo piloto; as outras ficam', async () => {
    const a = await proposeProfile(new FakeLlmClient([research, translation]), senna);
    const b = { ...a, f1dbId: 'alain-prost' };
    const fresh = { ...a, reasons: ['nova'] };
    expect(mergeProfiles([a, b], [fresh]).map((m) => [m.f1dbId, m.reasons])).toEqual([
      ['ayrton-senna', ['nova']],
      ['alain-prost', []],
    ]);
  });
});
