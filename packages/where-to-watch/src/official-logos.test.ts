import { describe, expect, it } from 'vitest';
import { parseOfficialLogos, WtwConfigError } from './config/loader.js';
import {
  channelKey,
  matchOfficialLogo,
  officialLogoName,
  officialLogosByBroadcaster,
  planOfficialLogos,
  type OfficialLogoComponent,
  type OfficialLogoTarget,
} from './official-logos.js';

const LIBRARY: OfficialLogoTarget[] = [
  { id: 'espn', name: 'ESPN', aliases: ['ESPN Argentina'], channels: ['ESPN 2', 'ESPN 3', 'ESPN 4'] },
  { id: 'fox_sports', name: 'Fox Sports', aliases: ['FOX Sports Argentina', 'Fox Sports 2'], channels: [] },
  { id: 'tnt_sports', name: 'TNT Sports', aliases: ['TNT'], channels: [] },
  { id: 'disney_plus', name: 'Disney+', aliases: ['Disney Plus'], channels: [] },
  { id: 'teleamazonas', name: 'Teleamazonas', aliases: ['Tele Amazonas'], channels: [] },
  { id: 'america_tv', name: 'América TV', aliases: ['America TV', 'Canal 4'], channels: [] },
  { id: 'tv_publica', name: 'TV Pública', aliases: ['Canal 7'], channels: [] },
  { id: 'televisa', name: 'Televisa', aliases: [], channels: ['Canal 5', 'Las Estrellas'] },
];

let seq = 0;
const component = (name: string): OfficialLogoComponent => {
  seq += 3;
  return { node: `1:${seq}`, name, letter: name[0]!, light: `1:${seq + 1}`, dark: `1:${seq + 2}` };
};

describe('nome do componente do acervo', () => {
  it('tira o prefixo da letra (inclusive repetido) e separa o HD', () => {
    expect(officialLogoName('E/ESPN HD')).toEqual({ name: 'ESPN HD', base: 'ESPN', hd: true });
    expect(officialLogoName('G/G/Globo')).toEqual({ name: 'Globo', base: 'Globo', hd: false });
    expect(officialLogoName('N/Nick Jr. HD   ')).toEqual({ name: 'Nick Jr. HD', base: 'Nick Jr.', hd: true });
    expect(officialLogoName('F/Fox Sports 2 HD  ').base).toBe('Fox Sports 2');
    expect(officialLogoName('S/Star +').base).toBe('Star +');
    expect(officialLogoName('A/A&E').base).toBe('A&E');
  });

  it('a chave do canal ignora acento, caixa, espaços e trata + como "plus"', () => {
    expect(channelKey('América TV')).toBe(channelKey('america tv'));
    expect(channelKey('Disney+')).toBe(channelKey('Disney Plus'));
    expect(channelKey('Tele Amazonas')).toBe(channelKey('Teleamazonas'));
  });
});

describe('mapeamento para a biblioteca', () => {
  it('nome da emissora → logo principal (acento, "+" e espaços não importam)', () => {
    expect(matchOfficialLogo('ESPN', LIBRARY)).toEqual({ broadcaster: 'espn', channel: null, strength: 3 });
    expect(matchOfficialLogo('Disney+', LIBRARY)?.broadcaster).toBe('disney_plus');
    expect(matchOfficialLogo('America TV', LIBRARY)?.broadcaster).toBe('america_tv');
    expect(matchOfficialLogo('Tele Amazonas', LIBRARY)?.broadcaster).toBe('teleamazonas');
  });

  it('canal do dicionário, alias numerado ou "<emissora> <número>" → logo do canal', () => {
    expect(matchOfficialLogo('ESPN 2', LIBRARY)).toEqual({
      broadcaster: 'espn',
      channel: 'ESPN 2',
      strength: 2,
    });
    expect(matchOfficialLogo('Las Estrellas', LIBRARY)).toMatchObject({
      broadcaster: 'televisa',
      channel: 'Las Estrellas',
    });
    expect(matchOfficialLogo('Fox Sports 2', LIBRARY)).toMatchObject({
      broadcaster: 'fox_sports',
      channel: 'Fox Sports 2',
    });
    expect(matchOfficialLogo('TNT Sports 3', LIBRARY)).toMatchObject({
      broadcaster: 'tnt_sports',
      channel: 'TNT Sports 3',
    });
  });

  it('alias comum liga mais fraco; alias genérico ("Canal 4") e nome desconhecido não ligam', () => {
    expect(matchOfficialLogo('TNT', LIBRARY)).toEqual({
      broadcaster: 'tnt_sports',
      channel: null,
      strength: 1,
    });
    expect(matchOfficialLogo('Canal 4', LIBRARY)).toBeNull();
    expect(matchOfficialLogo('Canal 7', LIBRARY)).toBeNull();
    expect(matchOfficialLogo('Cartoon Network', LIBRARY)).toBeNull();
    expect(matchOfficialLogo('ESPN Extra', LIBRARY)).toBeNull();
  });

  it('o mesmo nome em duas emissoras com a mesma força é ambíguo', () => {
    const lib = [...LIBRARY, { id: 'espn_mx', name: 'ESPN', aliases: [], channels: [] }];
    expect(matchOfficialLogo('ESPN', lib)).toBeNull();
  });
});

describe('planejamento do manifesto', () => {
  it('sem HD é o principal e o HD vira variante; alias fraco perde para o nome e fica sem mapeamento', () => {
    const plan = planOfficialLogos(
      [
        component('E/ESPN HD'),
        component('E/ESPN'),
        component('E/ESPN 2'),
        component('E/ESPN 2 HD'),
        component('T/TNT'),
        component('T/TNT Sports'),
        component('C/Cartoon Network'),
      ],
      LIBRARY,
    );
    const by = (name: string) => plan.find((p) => p.name === name)!;
    expect(by('ESPN')).toMatchObject({ broadcaster: 'espn', status: 'primary', hd: false });
    expect(by('ESPN HD')).toMatchObject({ broadcaster: 'espn', status: 'variant', hd: true });
    expect(by('ESPN 2')).toMatchObject({ broadcaster: 'espn', channel: 'ESPN 2', status: 'channel' });
    expect(by('ESPN 2 HD')).toMatchObject({ status: 'variant' });
    expect(by('TNT Sports')).toMatchObject({ broadcaster: 'tnt_sports', status: 'primary' });
    expect(by('TNT')).toMatchObject({ broadcaster: null, status: 'unmapped' });
    expect(by('TNT').note).toContain('TNT Sports');
    expect(by('Cartoon Network')).toMatchObject({ broadcaster: null, status: 'unmapped', note: null });
  });

  it('só HD no acervo: o HD é o principal', () => {
    const [only] = planOfficialLogos([component('F/Fox Sports  HD')], LIBRARY);
    expect(only).toMatchObject({
      name: 'Fox Sports HD',
      broadcaster: 'fox_sports',
      status: 'primary',
      hd: true,
    });
  });

  it('mapeamento da curadoria é mantido no replanejamento', () => {
    const c = component('C/Cartoon Network');
    const curated = {
      ...planOfficialLogos([c], LIBRARY)[0]!,
      broadcaster: 'tv_publica',
      status: 'primary' as const,
      curated: true,
      note: 'teste',
    };
    const [again] = planOfficialLogos([c], LIBRARY, [curated]);
    expect(again).toMatchObject({
      broadcaster: 'tv_publica',
      status: 'primary',
      curated: true,
      note: 'teste',
    });
  });

  it('agrupa principal e canais por emissora (variantes e sem mapeamento ficam de fora)', () => {
    const logos = planOfficialLogos(
      [component('E/ESPN'), component('E/ESPN HD'), component('E/ESPN 3'), component('C/Cartoon Network')],
      LIBRARY,
    );
    const g = officialLogosByBroadcaster({
      source: { description: 'x', fileKey: 'k', node: '1:1', importedAt: '2026-10-23' },
      excludedNodes: [],
      logos,
    });
    expect([...g.keys()]).toEqual(['espn']);
    expect(g.get('espn')!.primary?.name).toBe('ESPN');
    expect(g.get('espn')!.channels.map((c) => c.channel)).toEqual(['ESPN 3']);
  });
});

describe('manifesto (_official_logos.yaml)', () => {
  const known = new Set(LIBRARY.map((b) => b.id));
  const raw = (logos: unknown[], extra: Record<string, unknown> = {}) => ({
    schema_version: 1,
    source: {
      description: 'acervo oficial de logos (Figma)',
      figma_file: 'ABC',
      node: '335:3346',
      imported_at: '2026-10-23',
    },
    excluded_nodes: ['9:1'],
    logos,
    ...extra,
  });
  const espn = {
    node: '1:1',
    name: 'ESPN',
    letter: 'E',
    hd: false,
    light: '1:2',
    dark: '1:3',
    broadcaster: 'espn',
    channel: null,
    status: 'primary',
  };

  it('lê origem, excluídos e logos', () => {
    const m = parseOfficialLogos(
      raw([espn, { ...espn, node: '1:4', name: 'X', broadcaster: null, status: 'unmapped', dark: null }]),
      known,
    )!;
    expect(m.source).toEqual({
      description: 'acervo oficial de logos (Figma)',
      fileKey: 'ABC',
      node: '335:3346',
      importedAt: '2026-10-23',
    });
    expect(m.excludedNodes).toEqual(['9:1']);
    expect(m.logos[0]).toMatchObject({
      node: '1:1',
      light: '1:2',
      dark: '1:3',
      broadcaster: 'espn',
      curated: false,
      note: null,
    });
    expect(m.logos[1]).toMatchObject({ dark: null, status: 'unmapped' });
  });

  it('recusa emissora desconhecida, nó inválido, status incoerente e logo principal repetido', () => {
    expect(() => parseOfficialLogos(raw([{ ...espn, broadcaster: 'nao_existe' }]), known)).toThrow(
      WtwConfigError,
    );
    expect(() => parseOfficialLogos(raw([{ ...espn, light: '1-2' }]), known)).toThrow(/nó/);
    expect(() => parseOfficialLogos(raw([{ ...espn, status: 'unmapped' }]), known)).toThrow(
      /sem broadcaster/,
    );
    expect(() => parseOfficialLogos(raw([{ ...espn, status: 'channel' }]), known)).toThrow(/exige channel/);
    expect(() => parseOfficialLogos(raw([espn, { ...espn, node: '1:9' }]), known)).toThrow(
      /já tem logo principal/,
    );
    expect(() => parseOfficialLogos(raw([espn, espn]), known)).toThrow(/repetido/);
    expect(() => parseOfficialLogos({ logos: [] }, known)).toThrow(/source/);
  });
});
