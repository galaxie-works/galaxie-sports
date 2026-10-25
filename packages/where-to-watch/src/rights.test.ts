import { describe, expect, it } from 'vitest';
import { Blocklist, CountryDirectory } from './config/directory.js';
import { parseCountryConfig, parseLogos, WtwConfigError } from './config/loader.js';
import type { RightsEntry } from './config/types.js';
import {
  curatedDecides,
  effectiveRights,
  rightsAnswer,
  rightsCandidates,
  type MatchFacts,
} from './rights.js';
import { rowToRightsEntry, validateRightsResearch, type BroadcastRightsRow } from './rights-research.js';
import { validateCandidates } from './validator.js';

const empty = {
  organizers: ['organizador.example'],
  press: ['imprensa.example'],
  aggregators: ['guia.example'],
};

const broadcasters = {
  country: 'BR',
  broadcasters: [
    {
      id: 'emissora_a',
      name: 'Emissora A',
      medium: 'free_tv',
      access_model: 'free',
      domains: ['emissora-a.example'],
    },
    {
      id: 'canal_b',
      name: 'Canal B',
      medium: 'pay_tv',
      access_model: 'subscription',
      group: 'grupo_b',
      channels: ['Canal B 2'],
      domains: ['canal-b.example'],
    },
    {
      id: 'streaming_b',
      name: 'Streaming B',
      medium: 'streaming_svod',
      access_model: 'subscription',
      group: 'grupo_b',
      domains: ['streaming-b.example'],
    },
    {
      id: 'streaming_c',
      name: 'Streaming C',
      medium: 'streaming_svod',
      access_model: 'subscription',
      domains: ['streaming-c.example'],
    },
  ],
};

const row = (extra: Record<string, unknown>) => ({
  competition: 'liga-x',
  season: 2026,
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  sources: ['https://organizador.example/direitos'],
  ...extra,
});

function directory(rights: Record<string, unknown>[]): CountryDirectory {
  const cfg = parseCountryConfig('BR', broadcasters, { country: 'BR', rights }, empty);
  return new CountryDirectory(cfg, new Blocklist([]));
}

const match: MatchFacts = {
  home: 'Time Um',
  away: 'Time Dois',
  participants: ['Time Um', 'Time Dois'],
  round: 'Rodada 7',
};
const NOW = new Date('2026-10-20T12:00:00Z');
const KICKOFF = new Date('2026-10-25T20:00:00Z');

describe('tabela de direitos — esquema estendido', () => {
  it('vigência pelo dia civil do país, não pelo dia UTC', () => {
    const dir = directory([row({ holders: ['emissora_a'], valid_to: '2026-06-30' })]);
    // 21h30 em Brasília do último dia de vigência = 00h30 UTC do dia seguinte
    expect(dir.localDay(new Date('2026-07-01T00:30:00Z'))).toBe('2026-06-30');
    expect(dir.rightsFor('liga-x', new Date('2026-07-01T00:30:00Z'))?.holders).toEqual(['emissora_a']);
    expect(dir.rightsFor('liga-x', new Date('2026-07-01T03:30:00Z'))).toBeNull();
  });

  it('lê distribution, all_matches e regras; padrão "a confirmar"', () => {
    const dir = directory([
      row({
        holders: ['emissora_a', 'streaming_c'],
        distribution: 'split',
        all_matches: ['streaming_c'],
        rules: [{ holders: ['emissora_a'], home_teams: ['Time Um'] }],
      }),
    ]);
    const r = dir.rightsFor('liga-x', KICKOFF)!;
    expect(r).toMatchObject({
      distribution: 'split',
      allMatches: ['streaming_c'],
      rules: [{ holders: ['emissora_a'], homeTeams: ['Time Um'], teams: [], rounds: [] }],
      origin: 'curated',
    });
    expect(directory([row({ holders: ['emissora_a'] })]).rightsFor('liga-x', KICKOFF)!.distribution).toBe(
      'to_confirm',
    );
  });

  it('rejeita distribuição inválida, detentor de regra fora de holders e exclusive entre grupos', () => {
    expect(() => directory([row({ holders: ['emissora_a'], distribution: 'metade' })])).toThrow(
      WtwConfigError,
    );
    expect(() => directory([row({ holders: ['emissora_a'], all_matches: ['streaming_c'] })])).toThrow(
      /precisa estar em holders/,
    );
    expect(() => directory([row({ holders: ['emissora_a'], rules: [{ holders: ['emissora_a'] }] })])).toThrow(
      /home_teams, teams ou rounds/,
    );
    expect(() =>
      directory([row({ holders: ['emissora_a', 'streaming_c'], distribution: 'exclusive' })]),
    ).toThrow(/grupos diferentes/);
    // canal pago + streaming do mesmo grupo podem ser "exclusive"
    expect(() =>
      directory([row({ holders: ['canal_b', 'streaming_b'], distribution: 'exclusive' })]),
    ).not.toThrow();
  });

  it('logos: só ids conhecidos, https, com origem e licença', () => {
    const ids = new Set(['emissora_a']);
    const ok = parseLogos(
      {
        logos: [
          {
            id: 'emissora_a',
            url: 'https://upload.example/a.png',
            source_page: 'https://x/a',
            license: 'Domínio público',
          },
        ],
      },
      ids,
    );
    expect(ok.get('emissora_a')).toMatchObject({ license: 'Domínio público' });
    expect(() =>
      parseLogos({ logos: [{ id: 'zz', url: 'https://a', source_page: 'b', license: 'c' }] }, ids),
    ).toThrow(/não existe/);
    expect(() =>
      parseLogos({ logos: [{ id: 'emissora_a', url: 'http://a', source_page: 'b', license: 'c' }] }, ids),
    ).toThrow(/https/);
    expect(() =>
      parseLogos({ logos: [{ id: 'emissora_a', url: 'https://a', source_page: 'b' }] }, ids),
    ).toThrow(/license/);
  });
});

describe('resposta determinística dos direitos', () => {
  it('exclusive e all_matches: todos os jogos garantidos, sem alocação', () => {
    const dir = directory([row({ holders: ['canal_b', 'streaming_b'], distribution: 'exclusive' })]);
    expect(rightsAnswer(dir.rightsFor('liga-x', KICKOFF), match)).toMatchObject({
      deterministic: ['canal_b', 'streaming_b'],
      toAllocate: [],
      needsAllocation: false,
    });
  });

  it('split: só os de all_matches e os das regras que casam; o resto vai para a alocação', () => {
    const dir = directory([
      row({
        holders: ['emissora_a', 'streaming_b', 'streaming_c'],
        distribution: 'split',
        all_matches: ['streaming_c'],
        rules: [
          { holders: ['emissora_a'], home_teams: ['time um'] },
          { holders: ['streaming_b'], rounds: ['Rodada 9'] },
        ],
      }),
    ]);
    const r = dir.rightsFor('liga-x', KICKOFF);
    expect(rightsAnswer(r, match)).toMatchObject({
      deterministic: ['emissora_a', 'streaming_c'],
      toAllocate: ['streaming_b'],
      needsAllocation: true,
    });
    expect(rightsAnswer(r, { ...match, home: 'Time Dois', round: 'Rodada 9' }).deterministic).toEqual([
      'streaming_b',
      'streaming_c',
    ]);
    expect(rightsAnswer(null, match)).toMatchObject({ deterministic: [], needsAllocation: false });
  });

  it('a curada vence a pesquisada quando afirma algum detentor', () => {
    const a = { origin: 'curated', holders: ['emissora_a'], uncertainHolders: [] } as unknown as RightsEntry;
    const b = { origin: 'research', holders: ['emissora_b'], uncertainHolders: [] } as unknown as RightsEntry;
    expect(effectiveRights(a, b)).toBe(a);
    expect(effectiveRights(null, b)).toBe(b);
    expect(effectiveRights(null, undefined)).toBeNull();
    expect(curatedDecides(a)).toBe(true);
  });

  it('curada só com detentores incertos é lacuna: vale a pesquisada com detentores', () => {
    const lacuna = {
      origin: 'curated',
      holders: [],
      uncertainHolders: ['emissora_a', 'emissora_b'],
    } as unknown as RightsEntry;
    const pesquisada = {
      origin: 'research',
      holders: ['emissora_b'],
      uncertainHolders: [],
    } as unknown as RightsEntry;
    const vazia = { origin: 'research', holders: [], uncertainHolders: [] } as unknown as RightsEntry;
    expect(curatedDecides(lacuna)).toBe(false);
    expect(effectiveRights(lacuna, pesquisada)).toBe(pesquisada);
    // pesquisa sem detentor não derruba a curadoria (que ao menos lista os incertos)
    expect(effectiveRights(lacuna, vazia)).toBe(lacuna);
    expect(effectiveRights(lacuna, undefined)).toBe(lacuna);
  });
});

describe('validador — candidatas da tabela de direitos', () => {
  const ctx = (dir: CountryDirectory) => ({
    directory: dir,
    competitionSlug: 'liga-x',
    eventStartsAt: KICKOFF,
    now: NOW,
    match,
  });

  it('determinística publica sem LLM (0,8 + 0,1); detentor sem o jogo garantido fica "a confirmar"', () => {
    const dir = directory([
      row({ holders: ['emissora_a', 'streaming_c'], distribution: 'split', all_matches: ['streaming_c'] }),
    ]);
    const answer = rightsAnswer(dir.rightsFor('liga-x', KICKOFF), match);
    const report = validateCandidates(rightsCandidates(answer, dir), ctx(dir));
    const by = Object.fromEntries(report.options.map((o) => [o.broadcasterId, o]));
    expect(by.streaming_c).toMatchObject({ status: 'confirmed', confidence: 0.9, sourceKind: 'rights' });
    expect(by.streaming_c!.flags).toContain('from_rights');
    expect(by.emissora_a).toMatchObject({ status: 'probable' });
    expect(by.emissora_a!.flags).toContain('to_confirm');
  });

  it('não aceita "direitos" de quem não é detentor nem URL fora da linha', () => {
    const dir = directory([row({ holders: ['emissora_a'], distribution: 'exclusive' })]);
    const report = validateCandidates(
      [
        {
          broadcaster: 'Streaming C',
          origin: 'rights',
          evidence: [{ url: 'https://organizador.example/direitos', excerpt: 'x' }],
        },
        {
          broadcaster: 'Emissora A',
          origin: 'rights',
          evidence: [{ url: 'https://inventada.example/x', excerpt: 'x' }],
        },
      ],
      ctx(dir),
    );
    expect(report.discarded).toEqual([
      { broadcaster: 'Streaming C', reason: 'not_a_rights_holder' },
      { broadcaster: 'Emissora A', reason: 'no_accessible_evidence' },
    ]);
    expect(report.options).toEqual([]);
  });

  it('fonte que confirma o jogo tira o "a confirmar"', () => {
    const dir = directory([row({ holders: ['emissora_a'], distribution: 'split' })]);
    const answer = rightsAnswer(dir.rightsFor('liga-x', KICKOFF), match);
    const report = validateCandidates(
      [
        ...rightsCandidates(answer, dir),
        {
          broadcaster: 'Emissora A',
          evidence: [
            {
              url: 'https://emissora-a.example/grade',
              excerpt: 'Time Um x Time Dois na Emissora A',
              accessible: true,
              mentionsBroadcaster: true,
            },
          ],
        },
      ],
      ctx(dir),
    );
    expect(report.options).toHaveLength(1);
    expect(report.options[0]).toMatchObject({
      status: 'confirmed',
      confidence: 1,
      sourceKind: 'broadcaster',
    });
  });

  it('linha pesquisada usa a confiança validada da pesquisa', () => {
    const dir = directory([]);
    const researched = rowToRightsEntry({
      competitionSlug: 'liga-x',
      season: 2026,
      countryCode: 'BR',
      distribution: 'exclusive',
      status: 'confirmed',
      confidence: '0.70',
      notes: null,
      holders: [
        {
          broadcasterId: 'streaming_c',
          name: 'Streaming C',
          channels: [],
          kind: 'streaming',
          allMatches: true,
          status: 'confirmed',
          confidence: 0.7,
          evidence: [
            { url: 'https://imprensa.example/direitos', excerpt: 'x', fetchedAt: NOW.toISOString() },
          ],
          flags: [],
        },
      ],
    } as unknown as BroadcastRightsRow)!;
    expect(researched).toMatchObject({ origin: 'research', holders: ['streaming_c'], confidence: 0.7 });
    const answer = rightsAnswer(researched, match);
    const report = validateCandidates(rightsCandidates(answer, dir), { ...ctx(dir), rights: researched });
    expect(report.options[0]).toMatchObject({
      broadcasterId: 'streaming_c',
      status: 'confirmed',
      confidence: 0.8,
    });
  });
});

describe('validador da pesquisa de direitos por temporada', () => {
  const dir = directory([]);
  const ev = (url: string, extra: Record<string, unknown> = {}) => ({
    url,
    excerpt: 'Emissora A e Streaming C têm os direitos da Liga X',
    accessible: true,
    mentionsBroadcaster: true,
    ...extra,
  });

  it('confirma detentor com fonte permitida; desconhecido e sem fonte ficam de fora', () => {
    const r = validateRightsResearch(
      {
        country: 'BR',
        distribution: 'split',
        notes: null,
        holders: [
          {
            broadcaster: 'Emissora A',
            channels: [],
            kind: 'free_tv',
            allMatches: false,
            evidence: [ev('https://organizador.example/a'), ev('https://imprensa.example/b')],
          },
          {
            broadcaster: 'Canal Novo',
            channels: [],
            kind: 'pay_tv',
            allMatches: false,
            evidence: [ev('https://imprensa.example/c')],
          },
          {
            broadcaster: 'Streaming C',
            channels: [],
            kind: 'streaming',
            allMatches: true,
            evidence: [ev('https://guia.example/d')],
          },
        ],
      },
      { directory: dir, now: NOW },
    );
    const a = r.holders.find((h) => h.broadcasterId === 'emissora_a')!;
    expect(a).toMatchObject({ status: 'confirmed', confidence: 1 });
    expect(r.holders.find((h) => h.name === 'Canal Novo')).toMatchObject({
      status: 'pending',
      broadcasterId: null,
      flags: ['unknown_broadcaster'],
    });
    expect(r.discarded).toContainEqual({ broadcaster: 'Streaming C', reason: 'no_accessible_evidence' });
    expect(r.status).toBe('confirmed');
  });

  it('exclusive/all_matches só valem se todos os detentores passaram', () => {
    const r = validateRightsResearch(
      {
        country: 'BR',
        distribution: 'all_matches',
        notes: null,
        holders: [
          {
            broadcaster: 'Emissora A',
            channels: [],
            kind: 'free_tv',
            allMatches: true,
            evidence: [ev('https://emissora-a.example/x')],
          },
          {
            broadcaster: 'Streaming C',
            channels: [],
            kind: 'streaming',
            allMatches: true,
            evidence: [ev('https://streaming-c.example/y', { accessible: false })],
          },
        ],
      },
      { directory: dir, now: NOW },
    );
    expect(r.distribution).toBe('to_confirm');
    expect(r.flags).toContain('distribution_unverified');
  });

  it('página que não menciona a emissora não sustenta o detentor', () => {
    const r = validateRightsResearch(
      {
        country: 'BR',
        distribution: 'exclusive',
        notes: null,
        holders: [
          {
            broadcaster: 'Emissora A',
            channels: [],
            kind: 'free_tv',
            allMatches: true,
            evidence: [ev('https://imprensa.example/z', { mentionsBroadcaster: false })],
          },
        ],
      },
      { directory: dir, now: NOW },
    );
    expect(r.status).toBe('pending');
    expect(r.holders).toEqual([]);
  });
});
