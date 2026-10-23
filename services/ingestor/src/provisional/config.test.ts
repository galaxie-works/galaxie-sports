import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadFootballCatalog } from '../catalog/catalog-config.js';
import {
  loadProvisionalFixtures,
  parseProvisionalFile,
  ProvisionalConfigError,
  provisionalKickoff,
  zonedInstant,
} from './config.js';

const root = resolve(import.meta.dirname, '../../../..');
const yamlPath = resolve(root, 'config/fixtures/provisional.yaml');

const base = {
  key: 'football-teste-2026-final',
  sport: 'football',
  competition: 'conmebol-libertadores',
  season: 2026,
  stage: 'Final',
  home: { team: 121, name: 'Palmeiras' },
  away: { team: 450, name: 'Estudiantes L.P.' },
  date: '2026-11-28',
  time: null,
  timezone: 'America/Montevideo',
  venue: null,
  announced_by: 'Conmebol',
  status: 'announced',
  sources: [{ name: 'Conmebol', url: 'https://www.conmebol.com/', checked_at: '2026-10-23' }],
};
const file = (...fixtures: unknown[]) => ({ schema_version: 1, fixtures });

describe('config/fixtures/provisional.yaml', () => {
  it('segue o schema, com chaves únicas e competições do catálogo', async () => {
    const fixtures = await loadProvisionalFixtures(yamlPath);
    expect(fixtures.length).toBeGreaterThan(0);
    const catalog = new Set(
      (await loadFootballCatalog(resolve(root, 'config/competitions/football.yaml'))).map((c) => c.slug),
    );
    for (const f of fixtures) {
      if (f.sport === 'football') expect(catalog.has(f.competition), f.competition).toBe(true);
      expect(f.key.startsWith(`${f.sport}-${f.competition}-${f.season}-`), f.key).toBe(true);
    }
  });

  it('a final da Libertadores 2026: Palmeiras x Estudiantes, 28/11 no Centenário, horário a confirmar', async () => {
    const doc = parse(await readFile(yamlPath, 'utf8')) as unknown;
    const final = parseProvisionalFile(doc).find(
      (f) => f.key === 'football-conmebol-libertadores-2026-final',
    );
    expect(final).toMatchObject({
      competition: 'conmebol-libertadores',
      season: 2026,
      stage: 'Final',
      home: { team: 121 },
      away: { team: 450 },
      date: '2026-11-28',
      time: null,
      venue: { id: 1624, city: 'Montevideo' },
      announced_by: 'Conmebol',
      status: 'announced',
    });
    expect(final!.sources[0]!.url).toMatch(/conmebol\.com/);
  });
});

describe('schema dos jogos provisórios', () => {
  it('aceita "vencedor de" no lugar de um time e completa os padrões', () => {
    const [f] = parseProvisionalFile(
      file({ ...base, home: { winner_of: { stage: 'Semi-finals', teams: [121, 124] } } }),
    );
    expect(f).toMatchObject({ origin: 'curated', note: null, home: { winner_of: { teams: [121, 124] } } });
  });

  it.each([
    ['data inexistente', { date: '2026-02-30' }, 'date'],
    ['horário fora do formato', { time: '9h' }, 'time'],
    ['fuso inválido', { timezone: 'America/Atlantida' }, 'timezone'],
    ['fonte sem https', { sources: [{ name: 'x', url: 'http://x.com' }] }, 'sources.0.url'],
    ['sem fonte', { sources: [] }, 'sources'],
    ['status desconhecido', { status: 'maybe' }, 'status'],
    ['campo a mais', { extra: 1 }, '(raiz)'],
  ])('recusa %s', (_name, patch, path) => {
    expect(() => parseProvisionalFile(file({ ...base, ...patch }))).toThrow(ProvisionalConfigError);
    expect(() => parseProvisionalFile(file({ ...base, ...patch }))).toThrow(
      path === '(raiz)' ? /fixtures\.0/ : path,
    );
  });

  it('recusa chave repetida e mandante igual ao visitante', () => {
    expect(() => parseProvisionalFile(file(base, base))).toThrow(/chave repetida/);
    expect(() => parseProvisionalFile(file({ ...base, away: base.home }))).toThrow(/mesmo lado/);
  });
});

describe('início do jogo', () => {
  it('converte data e hora locais para UTC, inclusive com horário de verão', () => {
    expect(zonedInstant('2026-11-28', '17:00', 'America/Montevideo').toISOString()).toBe(
      '2026-11-28T20:00:00.000Z',
    );
    expect(zonedInstant('2026-10-25', '16:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-10-25T15:00:00.000Z',
    );
    expect(zonedInstant('2026-07-01', '21:00', 'America/Mexico_City').toISOString()).toBe(
      '2026-07-02T03:00:00.000Z',
    );
  });

  it('horário a confirmar guarda meio-dia local (mesmo dia nas Américas)', () => {
    expect(provisionalKickoff({ date: '2026-11-28', time: null, timezone: 'America/Montevideo' })).toEqual({
      startsAt: new Date('2026-11-28T15:00:00Z'),
      timeConfirmed: false,
    });
    expect(provisionalKickoff({ date: '2026-11-28', time: '19:30', timezone: 'America/Montevideo' })).toEqual(
      {
        startsAt: new Date('2026-11-28T22:30:00Z'),
        timeConfirmed: true,
      },
    );
  });
});
