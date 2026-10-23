import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AcervoManifest } from './manifest.js';
import { matchLogo, scoreTarget, type MatchTarget } from './match.js';
import { planManifest, resolveCountry, type CountryRow } from './plan.js';
import { coverage, renderReport } from './report.js';
import { nameFromSlug, scanAcervo } from './scan.js';
import { paletteFromSvg, parseColor } from './svg-palette.js';

const EXEMPLO = fileURLToPath(new URL('../../../test/fixtures/acervo-exemplo', import.meta.url));

const team = (id: string, name: string, country: string | null, extra: string[] = []): MatchTarget => ({
  id,
  kind: 'team',
  country,
  name,
  names: [{ value: name, weight: 1 }, ...extra.map((value) => ({ value, weight: 0.8 }))],
});

const TARGETS: MatchTarget[] = [
  team('pal', 'Palmeiras', 'BR'),
  team('pal-u20', 'Palmeiras U20', 'BR'),
  team('pal-w', 'Palmeiras W', 'BR'),
  team('fla', 'Flamengo', 'BR'),
  team('ame-mg', 'America Mineiro', 'BR'),
  team('ame-rn', 'America RN', 'BR'),
  team('ame-rj', 'America RJ', 'BR'),
  // "SE" é Sergipe, mas o normalizador lê como "Sociedade Esportiva"
  team('fla-se', 'Flamengo SE', 'BR'),
  {
    ...team('cam', 'Atletico-MG', 'BR'),
    names: [
      { value: 'Atletico-MG', weight: 1 },
      { value: 'Clube Atlético Mineiro', weight: 0.98 },
    ],
  },
  team('boca', 'Boca Juniors', 'AR', ['Xeneize']),
  {
    ...team('pal-sep', 'SE Palmeiras', 'PY'),
    names: [
      { value: 'SE Palmeiras', weight: 1 },
      { value: 'Sociedad Esportiva Palmeiras', weight: 0.98 },
    ],
  },
  team('ame-mx', 'Club America', 'MX'),
  team('rma', 'Real Madrid', 'ES'),
  team('rma-b', 'Real Madrid II', 'ES'),
  {
    id: 'serie-a-br',
    kind: 'competition',
    country: 'BR',
    name: 'Serie A',
    names: [{ value: 'Serie A', weight: 1 }],
  },
  {
    id: 'serie-a-it',
    kind: 'competition',
    country: 'IT',
    name: 'Serie A',
    names: [{ value: 'Serie A', weight: 1 }],
  },
  {
    id: 'libertadores',
    kind: 'competition',
    country: 'WORLD',
    name: 'CONMEBOL Libertadores',
    names: [{ value: 'CONMEBOL Libertadores', weight: 1 }],
  },
];

const COUNTRIES: CountryRow[] = [
  { code: 'BR', names: ['Brasil', 'Brazil'] },
  { code: 'AR', names: ['Argentina'] },
  { code: 'MX', names: ['México', 'Mexico'] },
  { code: 'ES', names: ['Espanha', 'Spain', 'España'] },
  { code: 'GB-ENG', names: ['Inglaterra', 'England'] },
  { code: 'IT', names: ['Itália', 'Italy'] },
];

describe('mapeamento por nome e país', () => {
  const m = (name: string, country: string, kind: 'team' | 'competition' = 'team') =>
    matchLogo({ key: `x/${name}`, kind, country, name }, TARGETS);

  it('liga o time principal do país, nunca a base, o feminino ou o B', () => {
    expect(m('Palmeiras', 'BR')).toMatchObject({ status: 'auto', targetId: 'pal' });
    expect(m('Real Madrid', 'ES')).toMatchObject({ status: 'auto', targetId: 'rma' });
    expect(m('Palmeiras U20', 'BR')).toMatchObject({ status: 'auto', targetId: 'pal-u20' });
  });

  it('ignora acentos e prefixos societários ("Club", "FC")', () => {
    expect(m('Club América', 'MX')).toMatchObject({ status: 'auto', targetId: 'ame-mx' });
    expect(m('Flamengo FC', 'BR')).toMatchObject({ status: 'auto', targetId: 'fla' });
    expect(m('CA Boca Juniors', 'AR')).toMatchObject({ status: 'auto', targetId: 'boca' });
  });

  it('usa os nomes da base semântica; apelido sozinho só sugere candidato', () => {
    expect(m('Sociedad Esportiva Palmeiras', 'PY')).toMatchObject({ status: 'auto', targetId: 'pal-sep' });
    expect(m('Xeneize', 'AR')).toMatchObject({
      status: 'ambiguous',
      targetId: null,
      candidates: [{ id: 'boca' }],
    });
  });

  it('nome só contido no do alvo não basta para ligar sozinho', () => {
    expect(m('Libertadores', 'WORLD', 'competition')).toMatchObject({ status: 'ambiguous', targetId: null });
  });

  it('só casa dentro do país', () => {
    expect(m('Palmeiras', 'AR').status).toBe('unmatched');
    expect(m('Serie A', 'IT', 'competition')).toMatchObject({ status: 'auto', targetId: 'serie-a-it' });
    expect(m('CONMEBOL Libertadores', 'WORLD', 'competition')).toMatchObject({
      status: 'auto',
      targetId: 'libertadores',
    });
    // time não casa com competição de mesmo nome
    expect(m('Serie A', 'BR').status).toBe('unmatched');
  });

  it('na dúvida não mapeia: homônimos viram ambíguos com os candidatos', () => {
    const r = m('América', 'BR');
    expect(r.status).toBe('ambiguous');
    expect(r.targetId).toBeNull();
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['ame-mg', 'ame-rj', 'ame-rn']);
  });

  it('logo sem sufixo de estado fica com o clube sem sufixo', () => {
    expect(m('Flamengo', 'BR')).toMatchObject({ status: 'auto', targetId: 'fla' });
    expect(m('Flamengo SE', 'BR')).toMatchObject({ status: 'auto', targetId: 'fla-se' });
    // o sufixo conta por variante: o nome oficial da base semântica não tem sufixo
    expect(m('Atlético Mineiro', 'BR')).toMatchObject({ status: 'auto', targetId: 'cam' });
  });

  it('o sufixo de estado desempata clubes brasileiros homônimos', () => {
    expect(m('America RN', 'BR')).toMatchObject({ status: 'auto', targetId: 'ame-rn' });
    expect(
      scoreTarget({ key: 'k', kind: 'team', country: 'BR', name: 'America RN' }, TARGETS[6]!),
    ).toBeLessThan(0.75);
  });

  it('nome sem par razoável fica sem par', () => {
    expect(m('Clube Fictício da Galáxia', 'BR')).toMatchObject({ status: 'unmatched', candidates: [] });
  });
});

describe('país da pasta', () => {
  it('aceita código, nome em qualquer idioma e "world"', () => {
    expect(resolveCountry('br', COUNTRIES)).toBe('BR');
    expect(resolveCountry('gb-eng', COUNTRIES)).toBe('GB-ENG');
    expect(resolveCountry('england', COUNTRIES)).toBe('GB-ENG');
    expect(resolveCountry('mexico', COUNTRIES)).toBe('MX');
    expect(resolveCountry('world', COUNTRIES)).toBe('WORLD');
    expect(resolveCountry('atlantida', COUNTRIES)).toBeNull();
  });
});

describe('varredura do pacote', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acervo-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('lê o acervo de exemplo com os nomes do acervo.yaml', () => {
    const scan = scanAcervo(EXEMPLO);
    expect(scan.info).toMatchObject({ id: 'exemplo', author: 'Galaxie Works' });
    expect(scan.logos).toHaveLength(9);
    expect(scan.logos.find((l) => l.key === 'teams/mx/america')).toMatchObject({
      kind: 'team',
      countryFolder: 'mx',
      name: 'Club América',
      file: 'teams/mx/america.svg',
    });
    expect(scan.logos.find((l) => l.key === 'teams/br/palmeiras')?.name).toBe('Palmeiras');
    expect(scan.logos.find((l) => l.key === 'competitions/br/serie-a')?.kind).toBe('competition');
  });

  it('prefere o SVG, guarda o maior PNG para a paleta e ignora o que está fora do layout', () => {
    writeFileSync(
      join(tmp, 'acervo.yaml'),
      'acervo: { id: t, name: T, author: A, license: L, revision: r1 }\n',
    );
    mkdirSync(join(tmp, 'teams', 'brazil'), { recursive: true });
    const png = (w: number) => {
      const b = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      b.writeUInt32BE(w, 16);
      b.writeUInt32BE(w, 20);
      return b;
    };
    writeFileSync(join(tmp, 'teams', 'brazil', 'sao-paulo.svg'), '<svg viewBox="0 0 10 10"></svg>');
    writeFileSync(join(tmp, 'teams', 'brazil', 'sao-paulo.png'), png(256));
    writeFileSync(join(tmp, 'teams', 'brazil', 'sao-paulo@4x.png'), png(1024));
    writeFileSync(join(tmp, 'teams', 'brazil', 'gremio.png'), png(512));
    writeFileSync(join(tmp, 'leia-me.txt'), 'x');
    const scan = scanAcervo(tmp);
    expect(scan.ignored).toEqual(['leia-me.txt']);
    expect(scan.logos.find((l) => l.key === 'teams/brazil/sao-paulo')).toMatchObject({
      name: 'Sao Paulo',
      file: 'teams/brazil/sao-paulo.svg',
      paletteFile: 'teams/brazil/sao-paulo@4x.png',
    });
    expect(scan.logos.find((l) => l.key === 'teams/brazil/gremio')).toMatchObject({
      file: 'teams/brazil/gremio.png',
    });
    expect(scan.logos.find((l) => l.key === 'teams/brazil/gremio')?.paletteFile).toBeUndefined();
  });

  it('nome a partir do slug', () => {
    expect(nameFromSlug('real-madrid')).toBe('Real Madrid');
  });
});

describe('manifesto', () => {
  const scan = scanAcervo(EXEMPLO);
  const now = new Date('2026-10-23T12:00:00Z');

  it('mapeia o acervo de exemplo de forma conservadora', () => {
    const { manifest } = planManifest(scan, TARGETS, COUNTRIES, undefined, now);
    const by = (key: string) => manifest.logos.find((l) => l.key === key)!;
    expect(by('teams/br/palmeiras')).toMatchObject({ match: 'auto', target_id: 'pal', country: 'BR' });
    expect(by('teams/mx/america')).toMatchObject({ match: 'auto', target_id: 'ame-mx' });
    expect(by('teams/br/america')).toMatchObject({ match: 'ambiguous', target_id: null });
    expect(by('teams/br/clube-ficticio')).toMatchObject({ match: 'unmatched', target_id: null });
    expect(by('competitions/br/serie-a')).toMatchObject({ match: 'auto', target_id: 'serie-a-br' });
    expect(manifest.acervo.revision).toBe('2026-10-23');
  });

  it('preserva a curadoria entre varreduras', () => {
    const previous: AcervoManifest = {
      schema_version: 1,
      acervo: scan.info,
      generated_at: now.toISOString(),
      logos: [
        {
          key: 'teams/br/america',
          kind: 'team',
          country: 'BR',
          name: 'América',
          file: 'x',
          sha256: 'x',
          target_id: 'ame-mg',
          match: 'manual',
        },
        {
          key: 'teams/br/palmeiras',
          kind: 'team',
          country: 'BR',
          name: 'Palmeiras',
          file: 'x',
          sha256: 'x',
          target_id: null,
          match: 'rejected',
        },
      ],
    };
    const { manifest } = planManifest(scan, TARGETS, COUNTRIES, previous, now);
    const by = (key: string) => manifest.logos.find((l) => l.key === key)!;
    expect(by('teams/br/america')).toMatchObject({
      match: 'manual',
      target_id: 'ame-mg',
      target_name: 'America Mineiro',
    });
    expect(by('teams/br/palmeiras')).toMatchObject({ match: 'rejected', target_id: null });
  });

  it('dois logos no mesmo alvo viram ambíguos', () => {
    const dup = {
      ...scan,
      logos: [
        ...scan.logos,
        { ...scan.logos.find((l) => l.key === 'teams/br/palmeiras')!, key: 'teams/br/palmeiras-retro' },
      ],
    };
    const { manifest } = planManifest(dup, TARGETS, COUNTRIES, undefined, now);
    const pal = manifest.logos.filter((l) => l.key.startsWith('teams/br/palmeiras'));
    expect(pal.map((l) => l.match)).toEqual(['ambiguous', 'ambiguous']);
    expect(pal.every((l) => l.target_id === null)).toBe(true);
  });

  it('relatório com cobertura por país, prioridade para a navegação', () => {
    const { manifest } = planManifest(scan, TARGETS, COUNTRIES, undefined, now);
    expect(coverage(manifest.logos).map((c) => c.country)).toEqual(['BR', 'AR', 'MX', 'ES']);
    expect(coverage(manifest.logos)[0]).toMatchObject({ total: 5, linked: 3, ambiguous: 1, unmatched: 1 });
    const md = renderReport(manifest);
    expect(md).toContain('Galaxie Works');
    expect(md).toContain('## Ambíguos (curadoria)');
    expect(md).toContain('`teams/br/clube-ficticio` (Clube Fictício da Galáxia)');
  });
});

describe('paleta de SVG', () => {
  it('lê cores hex, rgb e nomes', () => {
    expect(parseColor('#0b6e3a')).toEqual([11, 110, 58]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(200, 16, 46)')).toEqual([200, 16, 46]);
    expect(parseColor('navy')).toEqual([0, 0, 128]);
    expect(parseColor('none')).toBeNull();
    expect(parseColor('url(#g)')).toBeNull();
  });

  it('predominante pela área das formas; branco e preto não contam', () => {
    const svg = `<svg viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#ffffff"/>
      <rect x="0" y="0" width="80" height="80" style="fill:#0b6e3a"/>
      <circle cx="50" cy="50" r="20" fill="#f2c200"/>
      <path d="M0 0 L10 0 L10 10 Z" fill="#000"/>
    </svg>`;
    const p = paletteFromSvg(svg)!;
    expect(p.monochrome).toBe(false);
    expect(p.dominant).toBe('#0b6e3a');
    expect(p.secondary).toBe('#f2c200');
  });

  it('escudo do exemplo: River (branco com faixa vermelha) sai vermelho', async () => {
    const { readFileSync } = await import('node:fs');
    const river = paletteFromSvg(readFileSync(join(EXEMPLO, 'teams/ar/river-plate.svg')))!;
    expect(river.dominant).toBe('#d6001c');
    const boca = paletteFromSvg(readFileSync(join(EXEMPLO, 'teams/ar/boca-juniors.svg')))!;
    expect(boca).toMatchObject({ dominant: '#0033a0', secondary: '#f2c200' });
  });

  it('preto e branco é monocromático; sem cor sólida é null', () => {
    expect(
      paletteFromSvg(
        '<svg><rect width="10" height="10" fill="#111"/><rect width="5" height="5" fill="#fff"/></svg>',
      )?.monochrome,
    ).toBe(true);
    expect(paletteFromSvg('<svg><rect width="10" height="10" fill="url(#g)"/></svg>')).toBeNull();
  });
});
