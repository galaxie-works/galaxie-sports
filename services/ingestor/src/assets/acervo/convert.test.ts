import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { convertCountries, isCountryLayout } from './convert-countries.js';
import { convertFolders, FOLDER_LEAGUES, slugify } from './convert-folders.js';
import { matchLogo, shareWordStart, type MatchTarget } from './match.js';
import { planManifest, resolveCountry, type CountryRow } from './plan.js';
import { coverageByGroup, renderReport } from './report.js';
import { scanAcervo } from './scan.js';
import { unsafeSvgReason } from './svg-safety.js';

const INFO = {
  id: 'galaxie-proprio',
  name: 'Acervo próprio Galaxie',
  author: 'Wagner / Galaxie Works',
  license: 'Base própria; uso de marcas de clubes sujeito a licenciamento',
  revision: '2026-10-23',
};
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${fill}"/></svg>`;
const png = (w: number, seed = 0) => {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(w, 20);
  b[39] = seed;
  return b;
};
/** Cabeçalho de um WebP sem perdas (VP8L) de w × w. */
const webp = (w: number) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBPVP8L', 8, 'latin1');
  b[20] = 0x2f;
  b[21] = (w - 1) & 0xff;
  b[22] = (((w - 1) >> 8) & 0x3f) | (((w - 1) & 0x3) << 6);
  b[23] = ((w - 1) >> 2) & 0xff;
  b[24] = ((w - 1) >> 10) & 0x0f;
  return b;
};

const club = (
  id: string,
  name: string,
  country: string,
  competitions: string[] = [],
  extra: Partial<MatchTarget> = {},
): MatchTarget => ({
  id,
  kind: 'team',
  country,
  name,
  names: [{ value: name, weight: 1 }],
  competitions: new Set(competitions),
  ...extra,
});

describe('segurança do SVG', () => {
  it('passa SVG estático e recusa script, eventos, javascript:, foreignObject e referência externa', () => {
    expect(unsafeSvgReason(svg('#0b6e3a'))).toBeNull();
    expect(unsafeSvgReason('<svg><script>alert(1)</script></svg>')).toMatch(/ativo/);
    expect(unsafeSvgReason('<svg onload="x()"></svg>')).toMatch(/ativo/);
    expect(unsafeSvgReason('<svg><a href="javascript:x()"/></svg>')).toMatch(/ativo/);
    expect(unsafeSvgReason('<svg><foreignObject/></svg>')).toMatch(/ativo/);
    expect(unsafeSvgReason('<svg><image href="https://x.test/a.png"/></svg>')).toMatch(/ativo/);
    expect(unsafeSvgReason('<html></html>')).toBe('não é SVG');
  });
});

describe('conversor de pastas por competição', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acervo-conv-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(tmp, 'origem');
  const out = join(tmp, 'pacote');
  const put = (rel: string, body: string | Buffer) => {
    mkdirSync(join(src, rel, '..'), { recursive: true });
    writeFileSync(join(src, rel), body);
  };
  // liga nacional
  put('Brasil - Campeonato Brasileiro Série A/svg/Escudo - Palmeiras.svg', svg('#0b6e3a'));
  put('Brasil - Campeonato Brasileiro Série A/png/x128 - Escudo - Palmeiras.png', png(128));
  put('Brasil - Campeonato Brasileiro Série A/png/x512 - Escudo - Palmeiras.png', png(512));
  put('Brasil - Campeonato Brasileiro Série A/webp/x256 - Escudo - Palmeiras.webp', webp(256));
  put('Brasil - Campeonato Brasileiro Série A/webp/x512 - Escudo - Palmeiras.webp', webp(512));
  put('Brasil - Campeonato Brasileiro Série A/webp/x512 - Escudo - Falso.webp', 'RIFF');
  put('Brasil - Campeonato Brasileiro Série A/webp/x512 - Escudo - Só WebP.webp', webp(512));
  put('Brasil - Campeonato Brasileiro Série A/svg/Escudo - Mal.svg', '<svg><script>x</script></svg>');
  put('Brasil - Campeonato Brasileiro Série A/png/x256 - Escudo - Mal.png', png(256, 7));
  put('Brasil - Campeonato Brasileiro Série A/png/x256 - Escudo - Só PNG.png', png(256, 9));
  put('Brasil - Campeonato Brasileiro Série A/leia-me.txt', 'x');
  // torneio internacional: a mesma cópia do Palmeiras entra uma vez só (na pasta nacional)
  put('Mundial - Copa do Mundo/svg/Escudo - Palmeiras.svg', svg('#0b6e3a'));
  put('Mundial - Copa do Mundo/svg/Escudo - Seleção - País de Gales.svg', svg('#c8102e'));
  put('Mundial - Copa do Mundo/svg/Bandeira - Suíça.svg', svg('#ff0000'));
  put('Sem traço/svg/Escudo - X.svg', svg('#000'));

  const report = convertFolders({ source: src, out, info: INFO });

  it('gera o layout do pacote com nomes saneados, SVG preferido e o maior PNG para a paleta', () => {
    expect(report).toMatchObject({ folders: 2, logos: 5, svg: 2, webp: 2, pngOnly: 2, national: 1 });
    const dir = join(out, 'teams', 'brasil-campeonato-brasileiro-serie-a');
    expect(readFileSync(join(dir, 'palmeiras.svg'), 'utf8')).toContain('#0b6e3a');
    expect(readFileSync(join(dir, 'palmeiras.png')).readUInt32BE(16)).toBe(512);
    expect(existsSync(join(dir, 'so-png.png'))).toBe(true);
    // o maior WebP vai junto; WebP sem assinatura válida fica de fora
    expect(readFileSync(join(dir, 'palmeiras.webp'))[21]).toBe(511 & 0xff);
    expect(existsSync(join(dir, 'so-webp.webp'))).toBe(true);
    expect(report.ignored).toContain(
      'Brasil - Campeonato Brasileiro Série A/webp/x512 - Escudo - Falso.webp',
    );
    // SVG com script fica de fora e o escudo cai no PNG
    expect(existsSync(join(dir, 'mal.svg'))).toBe(false);
    expect(existsSync(join(dir, 'mal.png'))).toBe(true);
    expect(report.rejected).toEqual([
      expect.objectContaining({ file: 'Brasil - Campeonato Brasileiro Série A/svg/Escudo - Mal.svg' }),
    ]);
    expect(existsSync(join(out, 'teams', 'mundial-copa-do-mundo', 'selecao-pais-de-gales.svg'))).toBe(true);
  });

  it('ignora bandeiras, pastas fora do formato e cópias idênticas', () => {
    expect(report.flags).toEqual(['Mundial - Copa do Mundo/Suíça']);
    expect(report.ignored).toContain('Sem traço');
    expect(report.duplicates).toEqual([
      { file: 'Mundial - Copa do Mundo/Palmeiras', keptIn: 'Brasil - Campeonato Brasileiro Série A' },
    ]);
    expect(existsSync(join(out, 'teams', 'mundial-copa-do-mundo', 'palmeiras.svg'))).toBe(false);
  });

  it('acervo.yaml traz o acervo, os grupos com as ligas da api-sports e os nomes', () => {
    const doc = parse(readFileSync(join(out, 'acervo.yaml'), 'utf8'));
    expect(doc.acervo).toEqual(INFO);
    expect(doc.groups['brasil-campeonato-brasileiro-serie-a']).toEqual({
      country: 'Brasil',
      competition: 'Campeonato Brasileiro Série A',
      api_sports_leagues: [71],
    });
    expect(doc.logos['teams/mundial-copa-do-mundo/selecao-pais-de-gales']).toEqual({
      name: 'País de Gales',
      national: true,
    });
    const scan = scanAcervo(out);
    expect(scan.logos.find((l) => l.key.endsWith('/palmeiras'))).toMatchObject({
      name: 'Palmeiras',
      file: 'teams/brasil-campeonato-brasileiro-serie-a/palmeiras.svg',
      paletteFile: 'teams/brasil-campeonato-brasileiro-serie-a/palmeiras.png',
      formats: {
        svg: 'teams/brasil-campeonato-brasileiro-serie-a/palmeiras.svg',
        png: 'teams/brasil-campeonato-brasileiro-serie-a/palmeiras.png',
        webp: 'teams/brasil-campeonato-brasileiro-serie-a/palmeiras.webp',
      },
    });
    expect(scan.logos.find((l) => l.key.endsWith('/so-webp'))).toMatchObject({
      file: 'teams/brasil-campeonato-brasileiro-serie-a/so-webp.webp',
      formats: { webp: 'teams/brasil-campeonato-brasileiro-serie-a/so-webp.webp' },
    });
    expect(scan.logos.find((l) => l.national)).toMatchObject({ name: 'País de Gales' });
  });

  it('reconverter não deixa sobra do pacote anterior', () => {
    rmSync(join(src, 'Brasil - Campeonato Brasileiro Série A', 'png', 'x256 - Escudo - Só PNG.png'));
    convertFolders({ source: src, out, info: INFO });
    expect(existsSync(join(out, 'teams', 'brasil-campeonato-brasileiro-serie-a', 'so-png.png'))).toBe(false);
  });

  it('slug e tabela de ligas pelo nome da pasta', () => {
    expect(slugify('Atlético de Madrid')).toBe('atletico-de-madrid');
    expect(slugify('Turquia - 2. Lig')).toBe('turquia-2-lig');
    expect(FOLDER_LEAGUES['europa liga dos campeoes da uefa']).toEqual([2]);
  });
});

describe('casamento por seleção e por competição', () => {
  const COUNTRIES: CountryRow[] = [
    { code: 'BR', names: ['Brasil', 'Brazil'] },
    { code: 'GB-WLS', names: ['País de Gales', 'Wales', 'Gales'] },
    { code: 'NL', names: ['Holanda', 'Netherlands', 'Países Bajos'] },
    { code: 'AU', names: ['Austrália', 'Australia'] },
    // o cadastro do fornecedor repete o nome em inglês em outro código
    { code: 'AS', names: ['Australia'] },
  ];

  it('país pelo nome em português, com apelidos e desempate', () => {
    expect(resolveCountry('Países Baixos', COUNTRIES)).toBe('NL');
    expect(resolveCountry('Austrália', COUNTRIES)).toBe('AU');
    expect(resolveCountry('Europa', COUNTRIES)).toBe('WORLD');
    expect(resolveCountry('Mundial', COUNTRIES)).toBe('WORLD');
  });

  const T: MatchTarget[] = [
    club('wal', 'Wales', 'GB-WLS', [], { national: true, mainNational: true }),
    club('wal-u21', 'Wales U21', 'GB-WLS', [], { national: true }),
    club('bra', 'Brazil', 'BR', [], { national: true, mainNational: true }),
    club('adh', 'ADH Brasil', 'BR', [], { national: true }),
    club('bay', 'Bayern München', 'DE', ['bundesliga', 'ucl']),
    club('lev', 'Bayer Leverkusen', 'DE', ['bundesliga']),
    club('hsv', 'Hamburger SV', 'DE', ['bundesliga']),
    club('alanya', 'Alanyaspor', 'TR', ['super-lig']),
    club('goz', 'Göztepe', 'TR', ['super-lig']),
    club('wales-club', 'Wales FC', 'GB-WLS'),
  ];
  const logo = (name: string, extra: object = {}) =>
    matchLogo({ key: `k/${name}`, kind: 'team', country: 'WORLD', name, ...extra }, T);

  it('seleção: a principal do país, nunca base nem clube cadastrado como seleção', () => {
    expect(logo('País de Gales', { national: true, nationalCountry: 'GB-WLS' })).toMatchObject({
      status: 'auto',
      targetId: 'wal',
    });
    expect(logo('Brasil', { national: true, nationalCountry: 'BR' })).toMatchObject({ targetId: 'bra' });
    expect(logo('Cabo Verde', { national: true, nationalCountry: null }).status).toBe('unmatched');
  });

  it('competição: nome traduzido casa entre os times dela', () => {
    expect(logo('Bayern de Munique', { country: 'DE', competitionIds: ['bundesliga'] })).toMatchObject({
      status: 'auto',
      targetId: 'bay',
    });
    expect(logo('Hamburgo', { country: 'DE', competitionIds: ['bundesliga'] })).toMatchObject({
      status: 'auto',
      targetId: 'hsv',
    });
  });

  it('competição: parecido só no sufixo não liga ("Konyaspor" × "Alanyaspor")', () => {
    expect(shareWordStart('Konyaspor', 'Alanyaspor')).toBe(false);
    expect(shareWordStart('Copenhague', 'FC Copenhagen')).toBe(true);
    expect(logo('Konyaspor', { country: 'TR', competitionIds: ['super-lig'] }).status).not.toBe('auto');
  });

  it('competição sem o time no banco cai no país, com limiar alto', () => {
    expect(logo('Wales FC', { country: 'GB-WLS', competitionIds: ['outra'] })).toMatchObject({
      status: 'auto',
      targetId: 'wales-club',
    });
  });

  it('manifesto: liga nacional vence o torneio internacional; folga decide a disputa pelo mesmo time', () => {
    const scan = {
      info: { ...INFO },
      groups: {
        'alemanha-bundesliga': { country: 'Alemanha', competition: 'Bundesliga', api_sports_leagues: [78] },
        'europa-liga-dos-campeoes-da-uefa': {
          country: 'Europa',
          competition: 'Liga dos Campeões',
          api_sports_leagues: [2],
        },
      },
      ignored: [],
      rejected: {},
      logos: [
        {
          key: 'teams/alemanha-bundesliga/bayern',
          kind: 'team' as const,
          countryFolder: 'alemanha-bundesliga',
          name: 'Bayern München',
          file: 'a.svg',
          sha256: 'a',
        },
        {
          key: 'teams/europa-liga-dos-campeoes-da-uefa/bayern',
          kind: 'team' as const,
          countryFolder: 'europa-liga-dos-campeoes-da-uefa',
          name: 'Bayern München',
          file: 'b.svg',
          sha256: 'b',
        },
        {
          key: 'teams/alemanha-bundesliga/bayer',
          kind: 'team' as const,
          countryFolder: 'alemanha-bundesliga',
          name: 'Bayer Leverkusen',
          file: 'c.svg',
          sha256: 'c',
        },
      ],
    };
    const countries: CountryRow[] = [{ code: 'DE', names: ['Alemanha', 'Germany'] }];
    const { manifest } = planManifest(scan, T, countries, undefined, new Date('2026-10-23T12:00:00Z'), {
      leagueCompetitions: new Map([
        [78, 'bundesliga'],
        [2, 'ucl'],
      ]),
    });
    const by = (key: string) => manifest.logos.find((l) => l.key === key)!;
    expect(by('teams/alemanha-bundesliga/bayern')).toMatchObject({
      match: 'auto',
      target_id: 'bay',
      group: 'Alemanha - Bundesliga',
    });
    expect(by('teams/europa-liga-dos-campeoes-da-uefa/bayern')).toMatchObject({
      match: 'duplicate',
      target_id: null,
    });
    expect(by('teams/alemanha-bundesliga/bayer')).toMatchObject({ match: 'auto', target_id: 'lev' });
    expect(coverageByGroup(manifest.logos).find((c) => c.label === 'Alemanha - Bundesliga')).toMatchObject({
      linked: 2,
    });
    expect(renderReport(manifest)).toContain('## Por competição');
  });
});

describe('conversor da base por país', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acervo-pais-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(tmp, 'origem');
  const out = join(tmp, 'pacote');
  const put = (rel: string, body: string | Buffer) => {
    mkdirSync(join(src, rel, '..'), { recursive: true });
    writeFileSync(join(src, rel), body);
  };
  const crest = (dir: string, label: string, fill: string, seed: number) => {
    put(`${dir}/Original/svg/${label}.svg`, svg(fill));
    put(`${dir}/Original/png/x64 - ${label}.png`, png(64, seed));
    put(`${dir}/Original/png/x512 - ${label}.png`, png(512, seed));
    put(`${dir}/Original/webp/x512 - ${label}.webp`, webp(512));
  };
  crest('Brasil/Times/Atlético Mineiro', 'Escudo - Atlético Mineiro', '#000', 1);
  crest('Brasil/Seleções/Brasil', 'Escudo - Brasil', '#ffdf00', 2);
  crest(
    'Brasil/Campeonatos/Campeonato Brasileiro Série A',
    'Logo - Campeonato Brasileiro Série A',
    '#123',
    3,
  );
  crest('Internacionais/Campeonatos/Eurocopa 1960', 'Logo - Eurocopa 1960', '#456', 4);
  crest('Internacionais/Entidades/FIFA', 'Logo - FIFA', '#00f', 5);
  put('Suíça/Seleções/Suíça/Original/svg/Bandeira - Suíça.svg', svg('#f00'));
  put('Brasil/Times/Atlético Mineiro/Escuro/svg/Escudo - Atlético Mineiro.svg', svg('#fff'));

  it('reconhece o layout por país', () => {
    expect(isCountryLayout(src)).toBe(true);
  });

  const report = convertCountries({ source: src, out, info: INFO });

  it('grava times, seleções e competições com os três formatos', () => {
    expect(report).toMatchObject({ logos: 3, svg: 3, webp: 3, national: 1, competitions: 1 });
    const team = join(out, 'teams', 'brasil');
    expect(existsSync(join(team, 'atletico-mineiro.svg'))).toBe(true);
    expect(readFileSync(join(team, 'atletico-mineiro.png')).readUInt32BE(16)).toBe(512);
    expect(existsSync(join(team, 'atletico-mineiro.webp'))).toBe(true);
    expect(existsSync(join(team, 'selecao-brasil.svg'))).toBe(true);
    expect(existsSync(join(out, 'competitions', 'brasil', 'campeonato-brasileiro-serie-a.svg'))).toBe(true);
  });

  it('deixa de fora entidades, logos de edição, bandeiras e variantes além de Original', () => {
    expect(report.entities).toEqual(['Internacionais/Entidades/FIFA']);
    expect(report.editions).toEqual(['Internacionais/Campeonatos/Eurocopa 1960']);
    expect(report.flags).toEqual(['Suíça/Seleções/Suíça/Original']);
    expect(report.otherVariants).toEqual(['Brasil/Times/Atlético Mineiro/Escuro']);
  });

  it('a varredura lê o pacote com o nome da pasta e o país do grupo', () => {
    const scan = scanAcervo(out);
    expect(scan.groups['brasil']).toEqual({ country: 'Brasil' });
    expect(scan.groups['internacionais']).toEqual({ country: 'Mundial' });
    expect(scan.logos.find((l) => l.key === 'teams/brasil/selecao-brasil')).toMatchObject({
      name: 'Brasil',
      national: true,
    });
    expect(
      scan.logos.find((l) => l.key === 'competitions/brasil/campeonato-brasileiro-serie-a'),
    ).toMatchObject({ kind: 'competition', name: 'Campeonato Brasileiro Série A' });
  });

  it('a chave nova herda o vínculo e a curadoria da chave antiga pelo nome', () => {
    const countries: CountryRow[] = [{ code: 'BR', names: ['Brasil', 'Brazil'] }];
    const targets = [
      club('cam', 'Atletico-MG', 'BR'),
      club('bra', 'Brazil', 'BR', [], { national: true, mainNational: true }),
    ];
    const previous = {
      schema_version: 1,
      acervo: { ...INFO },
      generated_at: '2026-10-23T00:00:00Z',
      logos: [
        {
          key: 'teams/brasil-campeonato-brasileiro-serie-a/atletico-mineiro',
          kind: 'team' as const,
          country: 'BR',
          name: 'Atlético Mineiro',
          file: 'x.svg',
          sha256: 'x',
          target_id: 'cam',
          match: 'auto' as const,
          confidence: 0.92,
        },
        {
          key: 'teams/mundial-copa-do-mundo/selecao-brasil',
          kind: 'team' as const,
          country: 'WORLD',
          name: 'Brasil',
          national: true,
          file: 'y.svg',
          sha256: 'y',
          target_id: 'bra',
          match: 'manual' as const,
        },
      ],
    };
    const { manifest } = planManifest(scanAcervo(out), targets, countries, previous, new Date());
    const by = (key: string) => manifest.logos.find((l) => l.key === key)!;
    expect(by('teams/brasil/atletico-mineiro')).toMatchObject({
      target_id: 'cam',
      match: 'auto',
      confidence: 0.92,
    });
    expect(by('teams/brasil/selecao-brasil')).toMatchObject({ target_id: 'bra', match: 'manual' });
  });

  it('logo de competição liga pela liga da api-sports quando o nome de mercado difere do cadastro', () => {
    const countries: CountryRow[] = [{ code: 'BR', names: ['Brasil', 'Brazil'] }];
    const serieA: MatchTarget = {
      id: 'serie-a',
      kind: 'competition',
      country: 'BR',
      name: 'Serie A',
      names: [{ value: 'Serie A', weight: 1 }],
    };
    const plan = (target: MatchTarget) =>
      planManifest(scanAcervo(out), [target], countries, undefined, new Date(), {
        leagueCompetitions: new Map([[71, target.id]]),
      }).manifest.logos.find((l) => l.kind === 'competition')!;
    expect(plan(serieA)).toMatchObject({ target_id: 'serie-a', match: 'auto', confidence: 1 });
    // a liga existe, mas em outro país: não liga pela tabela
    expect(plan({ ...serieA, country: 'IT' }).target_id).toBeNull();
  });
});
