import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { normalizeName } from '../normalize.js';
import { loadWtwConfig, parseBlocklistEnv, parseCountryConfig, WtwConfigError } from './loader.js';
import { WTW_COUNTRIES } from './types.js';

const empty = { organizers: [], press: [], aggregators: [] };

describe('config/broadcasters e config/broadcast-rights do repositório', () => {
  const config = loadWtwConfig({ env: {} });

  it('carregam os 8 mercados com dicionário e tabela de direitos', () => {
    expect(config.countries.sort()).toEqual([...WTW_COUNTRIES].sort());
    for (const c of WTW_COUNTRIES) {
      const dir = config.directory(c);
      expect(dir.broadcasters.length, c).toBeGreaterThan(2);
      expect(dir.rights.length, c).toBeGreaterThan(0);
      expect(dir.allowedDomains().length, c).toBeLessThanOrEqual(100);
    }
  });

  it('usam slugs de competição do catálogo (config/competitions/football.yaml)', () => {
    const catalog = parse(
      readFileSync(new URL('../../../../config/competitions/football.yaml', import.meta.url), 'utf8'),
    ) as { competitions: { slug: string }[] };
    const slugs = new Set(catalog.competitions.map((c) => c.slug));
    for (const c of WTW_COUNTRIES)
      for (const r of config.directory(c).rights) expect(slugs.has(r.competition), `${c}:${r.competition}`).toBe(true);
  });

  it('não nomeiam operadoras omitidas por política editorial (só emissoras e plataformas)', () => {
    // Guarda de regressão: nenhuma entrada pode ser do tipo "operadora" — o dicionário só tem
    // emissoras/plataformas e a blocklist do repositório fica vazia (lista real fora do Git).
    const policy = parse(
      readFileSync(new URL('../../../../config/broadcasters/_policy.yaml', import.meta.url), 'utf8'),
    ) as { blocklist: unknown[] };
    expect(policy.blocklist).toEqual([]);
  });

  it('normaliza nomes, aliases, canais e afiliadas', () => {
    const br = config.directory('BR');
    expect(br.resolve('Rede Globo')?.entry.id).toBe('globo');
    expect(br.resolve('tv globo')?.entry.id).toBe('globo');
    expect(br.resolve('Disney Plus')?.entry.id).toBe('disney_plus');
    expect(br.resolve('Disney+ Premium')?.entry.id).toBe('disney_plus');
    expect(br.resolve('ESPN 4')).toMatchObject({ entry: { id: 'espn' }, channel: 'ESPN 4', matchedBy: 'channel' });
    expect(br.resolve('RBS TV')).toMatchObject({ entry: { id: 'globo' }, region: 'RS' });
    expect(br.resolve('Cazé TV')?.entry.id).toBe('cazetv');
    expect(br.resolve('Canal Inexistente')).toBeNull();
    expect(config.directory('MX').resolve('Azteca 7')).toMatchObject({ entry: { id: 'tv_azteca' }, channel: 'Azteca 7' });
  });

  it('renomeações com data: o nome antigo é o canal novo só depois da troca, e não na Argentina', () => {
    const cl = config.directory('CL');
    expect(cl.resolve('Fox Sports 2', '2026-10-24')).toMatchObject({
      entry: { id: 'espn' },
      channel: 'ESPN 6',
      matchedBy: 'dated_alias',
    });
    expect(cl.resolve('Fox Sports 3 HD', '2026-10-24')).toMatchObject({ channel: 'ESPN 7' });
    expect(cl.resolve('Fox Sports 2', '2023-12-31')).toBeNull();
    expect(cl.resolve('Fox Sports', '2026-10-24')).toMatchObject({ entry: { id: 'espn' }, channel: 'ESPN 4' });
    expect(config.directory('CO').resolve('Fox Sports 2', '2026-10-24')?.entry.id).toBe('espn');
    expect(config.directory('AR').resolve('Fox Sports 2', '2026-10-24')?.entry.id).toBe('fox_sports');
  });

  it('saídas: o canal fora do período não casa no dia e aparece como inativo', () => {
    const pe = config.directory('PE');
    expect(pe.resolve('GolPerú', '2025-12-31')?.entry.id).toBe('golperu');
    expect(pe.resolve('GolPerú', '2026-01-01')).toBeNull();
    expect(pe.lookup('Gol Peru', '2026-10-24')).toMatchObject({
      status: 'inactive',
      entry: { id: 'golperu' },
      validTo: '2025-12-31',
    });
  });

  it('classifica a fonte pelo domínio em relação à emissora da opção', () => {
    const br = config.directory('BR');
    const globo = br.byIdOrNull('globo')!;
    const sportv = br.byIdOrNull('sportv')!;
    const prime = br.byIdOrNull('prime_video')!;
    expect(br.classifySource('https://ge.globo.com/futebol/agenda', sportv)).toBe('broadcaster'); // mesmo grupo
    expect(br.classifySource('https://www.primevideo.com/x', prime)).toBe('broadcaster');
    expect(br.classifySource('https://ge.globo.com/futebol/agenda', prime)).toBe('press'); // outra emissora
    expect(br.classifySource('https://www.cbf.com.br/jogos', globo)).toBe('organizer');
    expect(br.classifySource('https://www.conmebol.com/noticias', globo)).toBe('organizer');
    expect(br.classifySource('https://www.lance.com.br/onde-assistir', globo)).toBe('press');
    expect(br.classifySource('https://www.livesoccertv.com/match/1', globo)).toBe('aggregator');
    expect(br.classifySource('https://blog.qualquer.net/post', globo)).toBe('unknown');
    expect(br.classifySource('https://www.youtube.com/@CazeTV/live', br.byIdOrNull('cazetv'))).toBe('broadcaster');
    expect(br.classifySource('https://www.youtube.com/@outro/live', br.byIdOrNull('cazetv'))).toBe('unknown');
  });

  it('acha a linha vigente da tabela de direitos pela data do jogo', () => {
    const br = config.directory('BR');
    expect(br.rightsFor('conmebol-libertadores', new Date('2026-10-22T00:30:00Z'))?.holders).toContain('globo');
    expect(br.rightsFor('conmebol-libertadores', new Date('2027-03-01T00:00:00Z'))?.season).toBe(2027);
    expect(br.rightsFor('liga-mx', new Date('2026-10-22T00:00:00Z'))).toBeNull();
    expect(br.rightsFor(null, new Date())).toBeNull();
  });

  it('direitos do BR declaram a distribuição; logos só com origem e licença', () => {
    const br = config.directory('BR');
    expect(br.rightsFor('premier-league', new Date('2026-10-24T14:00:00Z'))).toMatchObject({
      distribution: 'exclusive',
      holders: ['espn', 'disney_plus'],
    });
    expect(br.rightsFor('brasileirao-serie-a', new Date('2026-10-24T14:00:00Z'))?.distribution).toBe('split');
    expect(config.logos.size).toBeGreaterThan(20);
    for (const logo of config.logos.values()) {
      expect(logo.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
      expect(logo.license.length).toBeGreaterThan(3);
    }
  });

  it('allowlist do agente inclui organizador, emissoras e imprensa, mas não agregadores', () => {
    const domains = config.directory('AR').allowedDomains();
    expect(domains).toContain('conmebol.com');
    expect(domains).toContain('tycsports.com');
    expect(domains).toContain('ole.com.ar');
    expect(domains).not.toContain('livesoccertv.com');
    expect(domains.every((d) => !d.includes('/'))).toBe(true);
  });
});

describe('blocklist editorial', () => {
  it('é carregada do ambiente (nomes e domínios) sem constar do repositório', () => {
    const config = loadWtwConfig({ env: { WTW_BLOCKLIST: 'Operadora Bloqueada X, bloqueada-x.example' } });
    const bl = config.directory('BR').blocklist;
    expect(bl.isBlockedName('operadora bloqueada x')).toBe(true);
    expect(bl.isBlockedUrl('https://www.bloqueada-x.example/grade')).toBe(true);
    expect(bl.isBlockedName('Globo')).toBe(false);
  });

  it('parseBlocklistEnv separa nomes de domínios', () => {
    expect(parseBlocklistEnv('Nome Qualquer, site.example.com, outro.tv/path')).toEqual([
      { name: 'Nome Qualquer', aliases: [], domains: [] },
      { name: null, aliases: [], domains: ['site.example.com'] },
      { name: null, aliases: [], domains: ['outro.tv/path'] },
    ]);
  });
});

describe('validação do YAML', () => {
  const base = {
    country: 'BR',
    broadcasters: [
      { id: 'a', name: 'Canal A', medium: 'free_tv', access_model: 'free', domains: ['a.example'] },
      { id: 'b', name: 'Canal B', medium: 'pay_tv', access_model: 'subscription', domains: ['b.example'] },
    ],
  };

  it('rejeita medium inválido', () => {
    expect(() =>
      parseCountryConfig('BR', { ...base, broadcasters: [{ ...base.broadcasters[0], medium: 'tv' }] }, null, empty),
    ).toThrow(WtwConfigError);
  });

  it('rejeita nome ambíguo entre duas entradas', () => {
    const raw = {
      ...base,
      broadcasters: [base.broadcasters[0], { ...base.broadcasters[1], aliases: ['canal a'] }],
    };
    expect(() => parseCountryConfig('BR', raw, null, empty)).toThrow(/ambíguo/);
  });

  it('rejeita detentor que não está no dicionário e períodos sobrepostos', () => {
    const rights = (holders: string[], extra: object[] = []) => ({
      country: 'BR',
      rights: [
        { competition: 'x', season: 2026, valid_from: '2026-01-01', valid_to: '2026-12-31', holders, sources: ['https://o.example'] },
        ...extra,
      ],
    });
    expect(() => parseCountryConfig('BR', base, rights(['zz']), empty)).toThrow(/não existe/);
    expect(() =>
      parseCountryConfig(
        'BR',
        base,
        rights(['a'], [{ competition: 'x', season: 2026, valid_from: '2026-06-01', valid_to: '2027-01-01', holders: ['b'], sources: ['https://o.example'] }]),
        empty,
      ),
    ).toThrow(/sobreposto/);
  });

  it('apelido com validade precisa de data, e a data no formato do YAML', () => {
    const withAlias = (alias: unknown, extra: object = {}) => ({
      ...base,
      broadcasters: [{ ...base.broadcasters[0], aliases: ['A', alias], ...extra }, base.broadcasters[1]],
    });
    const ok = parseCountryConfig(
      'BR',
      withAlias({ name: 'Canal Velho', channel: 'Canal A 2', valid_from: '2024-02-01' }),
      null,
      empty,
    );
    expect(ok.broadcasters[0]).toMatchObject({
      aliases: ['A'],
      datedAliases: [{ name: 'Canal Velho', channel: 'Canal A 2', validFrom: '2024-02-01', validTo: null }],
    });
    expect(() => parseCountryConfig('BR', withAlias({ name: 'Canal Velho' }), null, empty)).toThrow(/valid_from/);
    expect(() =>
      parseCountryConfig('BR', withAlias('B', { valid_from: '2026-01-01', valid_to: '2025-01-01' }), null, empty),
    ).toThrow(/anterior/);
    // o apelido com validade também entra na checagem de nome ambíguo
    expect(() =>
      parseCountryConfig('BR', withAlias({ name: 'Canal B', valid_from: '2024-01-01' }), null, empty),
    ).toThrow(/ambíguo/);
  });

  it('exige que o país do arquivo bata com o nome', () => {
    expect(() => parseCountryConfig('AR', base, null, empty)).toThrow(/country deve ser AR/);
  });

  it('normalizeName trata acento, caixa e "+"', () => {
    expect(normalizeName('Disney+ Premium')).toBe(normalizeName('disney plus premium'));
    expect(normalizeName('Chilevisión')).toBe('chilevision');
  });
});
