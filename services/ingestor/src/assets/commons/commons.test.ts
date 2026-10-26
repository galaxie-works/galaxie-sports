import { AiDisabledError } from '@galaxie/ai-ledger';
import { describe, expect, it, vi } from 'vitest';
import type { CommonsFile, WikimediaClient } from './client.js';
import type { Discovery } from './discover.js';
import {
  classifyLicense,
  firstHref,
  plainText,
  readAttribution,
  readLicense,
  yearOf,
  type ExtMetadata,
} from './license.js';
import { mergeEntry, type ManifestEntry } from './manifest.js';
import { mapCommons, type Ranker } from './map.js';
import { targetsFor, type DriverTarget } from './scope.js';
import { choose, eligible, photoBase } from './select.js';

const meta = (license: string, short: string, extra: Record<string, string> = {}): ExtMetadata => ({
  License: { value: license },
  LicenseShortName: { value: short },
  LicenseUrl: { value: `https://creativecommons.org/licenses/${license}` },
  Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Gabriele">Gabriele</a>' },
  DateTimeOriginal: { value: '1989-04-23' },
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])),
});

const file = (title: string, over: Partial<CommonsFile> = {}): CommonsFile => ({
  title,
  pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
  url: 'https://upload.wikimedia.org/x.jpg',
  thumbUrl: 'https://upload.wikimedia.org/thumb/x.jpg',
  thumbWidth: 512,
  thumbHeight: 400,
  width: 1200,
  height: 900,
  mime: 'image/jpeg',
  extmetadata: meta('cc-by-2.0', 'CC BY 2.0'),
  categories: [],
  ...over,
});

const senna: DriverTarget = {
  kind: 'driver',
  f1dbId: 'ayrton-senna',
  name: 'Ayrton Senna',
  dateOfBirth: '1960-03-21',
  seasons: [1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994],
  highlight: { target: 'car/mclaren/1988', year: 1988, reason: 'título de 1988', entrant: 'mclaren' },
};

describe('licença da Commons', () => {
  it('aceita domínio público, CC0, CC BY e CC BY-SA', () => {
    expect(classifyLicense('pd', 'Public domain').allowed).toBe(true);
    expect(classifyLicense('cc0', 'CC0').allowed).toBe(true);
    expect(classifyLicense('cc-by-2.0', 'CC BY 2.0')).toEqual({ allowed: true, shareAlike: false });
    expect(classifyLicense('cc-by-sa-4.0', 'CC BY-SA 4.0')).toEqual({ allowed: true, shareAlike: true });
  });

  it('recusa NC, ND, fair use e sem licença', () => {
    expect(classifyLicense('cc-by-nc-2.0', 'CC BY-NC 2.0').allowed).toBe(false);
    expect(classifyLicense('cc-by-nc-sa-3.0', 'CC BY-NC-SA 3.0').allowed).toBe(false);
    expect(classifyLicense('cc-by-nd-4.0', 'CC BY-ND 4.0').allowed).toBe(false);
    expect(classifyLicense(null, 'Fair use').allowed).toBe(false);
    expect(classifyLicense(null, null).allowed).toBe(false);
    expect(classifyLicense('gfdl', 'GFDL').allowed).toBe(false);
  });

  it('lê autor, link, data e marca o share-alike', () => {
    const v = readLicense(meta('cc-by-sa-3.0', 'CC BY-SA 3.0'));
    expect(v).toMatchObject({
      ok: true,
      value: {
        license: 'CC BY-SA 3.0',
        author: 'Gabriele',
        authorUrl: 'https://commons.wikimedia.org/wiki/User:Gabriele',
        shareAlike: true,
        dateTaken: '1989-04-23',
      },
    });
  });

  it('recusa arquivo marcado como não livre ou CC BY sem autor', () => {
    expect(readLicense(meta('cc-by-2.0', 'CC BY 2.0', { NonFree: 'true' })).ok).toBe(false);
    expect(
      readLicense({ License: { value: 'cc-by-2.0' }, LicenseShortName: { value: 'CC BY 2.0' } }).ok,
    ).toBe(false);
    // domínio público não exige autor
    expect(readLicense({ License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } }).ok).toBe(
      true,
    );
  });

  it('atribuição pedida pelo autor (`Attribution`) em texto, separada do `Credit` (a fonte)', () => {
    const v = readLicense(
      meta('cc-by-4.0', 'CC BY 4.0', {
        Credit: 'Own work',
        Attribution: '<a href="https://example.org/fulano">Fulano</a> &amp; <b>Exemplo FC</b>',
      }),
    );
    expect(v).toMatchObject({ ok: true, value: { credit: 'Own work', attribution: 'Fulano & Exemplo FC' } });
    // sem o campo, ou só com espaço: nulo
    expect(readLicense(meta('cc-by-4.0', 'CC BY 4.0'))).toMatchObject({ value: { attribution: null } });
    expect(readAttribution({ Attribution: { value: '  ' } })).toBeNull();
    expect(readAttribution({ Attribution: { value: '<span>Foto: <i>Beltrano</i></span>' } })).toBe(
      'Foto: Beltrano',
    );
  });

  it('texto do HTML: entidades numéricas decodificadas e nada de HTML depois de decodificar', () => {
    // o MediaWiki entrega o © e o espaço fixo como entidades numéricas (decimais e hexadecimais)
    expect(plainText('&#169; Fulano&#160;2020 &#x2014; Liga')).toBe('© Fulano 2020 — Liga');
    // tag escapada vira texto e é tirada de novo: não sai `<script>` no `text` da API
    expect(plainText('Fulano &lt;script&gt;alert(1)&lt;/script&gt;')).toBe('Fulano alert(1)');
    // escape duplo decodifica uma vez só (`&amp;` junto das outras): fica o texto, sem `<b>`
    expect(plainText('&amp;lt;b&amp;gt;Fulano')).toBe('&lt;b&gt;Fulano');
    // vale para autor e `Credit`, que usam a mesma função
    const v = readLicense(
      meta('cc-by-4.0', 'CC BY 4.0', { Artist: '&#169; Fulano &lt;b&gt;', Credit: 'Own work &#38; mais' }),
    );
    expect(v).toMatchObject({ value: { author: '© Fulano', credit: 'Own work & mais' } });
  });

  it('texto e links do HTML da Commons; ano da data', () => {
    expect(plainText('<span>Instituto <b>Ayrton</b>&nbsp;Senna</span>')).toBe('Instituto Ayrton Senna');
    expect(firstHref('<a href="/wiki/User:X">X</a>')).toBe('https://commons.wikimedia.org/wiki/User:X');
    expect(yearOf('circa July 1990')).toBe(1990);
    expect(yearOf('Unknown date')).toBeNull();
  });
});

describe('regras de escolha', () => {
  const discovery = (
    files: { f: CommonsFile; season?: number; p18?: boolean; portrait?: boolean }[],
  ): Discovery => ({
    target: senna,
    wikidata: 'Q10490',
    category: 'Ayrton Senna',
    note: null,
    candidates: files.map(({ f, season, p18, portrait }) => ({
      file: f,
      season: season ?? null,
      wikidataImage: !!p18,
      portraitCategory: !!portrait,
    })),
  });

  it('elimina licença, tipo, resolução, título de não-foto e fora da época', () => {
    const d = discovery([
      { f: file('File:Senna imola89.jpg') },
      { f: file('File:Senna NC.jpg', { extmetadata: meta('cc-by-nc-2.0', 'CC BY-NC 2.0') }) },
      { f: file('File:Senna.svg', { mime: 'image/svg+xml' }) },
      { f: file('File:Senna small.jpg', { width: 447, height: 422 }) },
      { f: file('File:Ayrton Senna signature.jpg') },
      {
        f: file('File:Senna 2010.jpg', {
          extmetadata: meta('cc-by-2.0', 'CC BY 2.0', { DateTimeOriginal: '2010-06-11' }),
        }),
      },
    ]);
    const { ok, rejected } = eligible(d);
    expect(ok.map((e) => e.candidate.file.title)).toEqual(['File:Senna imola89.jpg']);
    expect(rejected.map((r) => r.reason)).toEqual([
      'não comercial (NC)',
      'não é foto (image/svg+xml)',
      'resolução baixa (447×422)',
      'título indica que não é foto do piloto/carro',
      'fora da época (2010)',
    ]);
  });

  it('sem IA: retrato pela foto do Wikidata, ação por temporada (no máximo duas por ano)', () => {
    const d = discovery([
      { f: file('File:Retrato.jpg'), p18: true, portrait: true },
      { f: file('File:A 1988.jpg'), season: 1988 },
      { f: file('File:B 1988.jpg'), season: 1988 },
      { f: file('File:C 1988.jpg'), season: 1988 },
      { f: file('File:D 1990.jpg'), season: 1990 },
    ]);
    const { ok } = eligible(d);
    const chosen = choose(d, ok, null);
    expect(chosen.map((c) => [c.eligible.candidate.file.title, c.role])).toEqual([
      ['File:Retrato.jpg', 'portrait'],
      ['File:A 1988.jpg', 'action'],
      ['File:B 1988.jpg', 'action'],
      ['File:D 1990.jpg', 'action'],
    ]);
    expect(chosen.every((c) => c.selectedBy === 'rules')).toBe(true);
  });

  it('no máximo maxAction fotos de ação, com ou sem retrato', () => {
    const seasons = [1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991];
    const action = seasons.map((y) => ({ f: file(`File:Senna ${y}.jpg`), season: y }));
    const noPortrait = discovery(action);
    const a = choose(noPortrait, eligible(noPortrait).ok, null);
    expect(a.filter((c) => c.role === 'action')).toHaveLength(6);
    expect(a.some((c) => c.role === 'portrait')).toBe(false);
    const withPortrait = discovery([{ f: file('File:Retrato.jpg'), p18: true, portrait: true }, ...action]);
    const b = choose(withPortrait, eligible(withPortrait).ok, null, { maxAction: 3 });
    expect(b.map((c) => c.role)).toEqual(['portrait', 'action', 'action', 'action']);
  });

  it('retrato: o mais recente, mesmo que outro tenha nota maior (Hamilton na Ferrari, não na Mercedes)', () => {
    const d = discovery([
      {
        f: file('File:Retrato 1988.jpg', { width: 4000, height: 3000 }),
        p18: true,
        portrait: true,
        season: 1988,
      },
      { f: file('File:Retrato 1991.jpg'), portrait: true, season: 1991 },
      { f: file('File:Retrato sem data.jpg'), portrait: true },
    ]);
    const portrait = choose(d, eligible(d).ok, null).find((c) => c.role === 'portrait');
    expect(portrait?.eligible.candidate.file.title).toBe('File:Retrato 1991.jpg');
    // com IA, entre os que ela classificou como retrato
    const ai = choose(d, eligible(d).ok, [
      { index: 0, kind: 'portrait', keep: true, quality: 9 },
      { index: 1, kind: 'portrait', keep: true, quality: 6 },
      { index: 2, kind: 'action', keep: true, quality: 8 },
    ]).find((c) => c.role === 'portrait');
    expect(ai?.eligible.candidate.file.title).toBe('File:Retrato 1991.jpg');
  });

  it('retrato: o mais recente dentro da carreira; o de depois (o piloto idoso num evento) fica por último', () => {
    const d = discovery([
      { f: file('File:Senna 1990.jpg'), portrait: true, season: 1990 },
      {
        f: file('File:Homenagem 2014.jpg', {
          extmetadata: meta('cc-by-2.0', 'CC BY 2.0', { DateTimeOriginal: '2014-05-01' }),
        }),
        p18: true,
        portrait: true,
      },
      { f: file('File:Retrato sem data.jpg'), portrait: true },
    ]);
    const portrait = choose(d, eligible(d).ok, null).find((c) => c.role === 'portrait');
    expect(portrait?.eligible.candidate.file.title).toBe('File:Senna 1990.jpg');
    // sem retrato da carreira, o sem data vem antes do de fora da época
    const late = discovery(
      d.candidates.slice(1).map((c) => ({ f: c.file, p18: c.wikidataImage, portrait: true })),
    );
    expect(
      choose(late, eligible(late).ok, null).find((c) => c.role === 'portrait')?.eligible.candidate.file.title,
    ).toBe('File:Retrato sem data.jpg');
  });

  it('com IA: só entra o que ela manteve, na ordem da nota dela', () => {
    const d = discovery([
      { f: file('File:Estatua.jpg') },
      { f: file('File:Podio.jpg'), season: 1989 },
      { f: file('File:Rosto.jpg') },
    ]);
    const { ok } = eligible(d);
    const chosen = choose(d, ok, [
      { index: 0, kind: 'other', keep: false, quality: 9, reason: 'estátua' },
      { index: 1, kind: 'action', keep: true, quality: 8 },
      { index: 2, kind: 'portrait', keep: true, quality: 7 },
    ]);
    expect(chosen.map((c) => [c.eligible.candidate.file.title, c.role, c.selectedBy])).toEqual([
      ['File:Rosto.jpg', 'portrait', 'gemini'],
      ['File:Podio.jpg', 'action', 'gemini'],
    ]);
  });

  it('com IA sem retrato: vale o candidato das regras que ela manteve como foto do piloto (nunca "car" nem "other")', () => {
    const d = discovery([
      { f: file('File:Wikidata.jpg'), p18: true, portrait: true },
      { f: file('File:Corrida.jpg'), season: 1988 },
    ]);
    const { ok } = eligible(d);
    const kept = choose(d, ok, [
      { index: 0, kind: 'action', keep: true, quality: 6 },
      { index: 1, kind: 'action', keep: true, quality: 8 },
    ]);
    expect(kept.map((c) => [c.eligible.candidate.file.title, c.role])).toEqual([
      ['File:Wikidata.jpg', 'portrait'],
      ['File:Corrida.jpg', 'action'],
    ]);
    const dropped = choose(d, ok, [
      { index: 0, kind: 'other', keep: false, quality: 6 },
      { index: 1, kind: 'action', keep: true, quality: 8 },
    ]);
    expect(dropped.some((c) => c.role === 'portrait')).toBe(false);
    // "other" mantida (não é o piloto, ou não é foto dele): também não vira retrato
    const other = choose(d, ok, [
      { index: 0, kind: 'other', keep: true, quality: 6 },
      { index: 1, kind: 'action', keep: true, quality: 8 },
    ]);
    expect(other.some((c) => c.role === 'portrait')).toBe(false);
    const car = choose(d, ok, [
      { index: 0, kind: 'car', keep: true, quality: 6 },
      { index: 1, kind: 'action', keep: true, quality: 8 },
    ]);
    expect(car.some((c) => c.role === 'portrait')).toBe(false);
  });
});

describe('manifesto', () => {
  it('a curadoria sobrevive: manual fica, rejected não volta', () => {
    const d: Discovery = {
      target: senna,
      wikidata: 'Q10490',
      category: 'Ayrton Senna',
      note: null,
      candidates: [
        { file: file('File:A.jpg'), season: 1988, wikidataImage: false, portraitCategory: false },
        { file: file('File:B.jpg'), season: 1989, wikidataImage: false, portraitCategory: false },
      ],
    };
    const chosen = choose(d, eligible(d).ok, null);
    const base = mergeEntry(senna, d, chosen, undefined);
    const previous: ManifestEntry = {
      ...base,
      photos: [
        { ...base.photos[0]!, file: 'File:Manual.jpg', match: 'manual' },
        { ...base.photos[0]!, file: 'File:A.jpg', match: 'rejected' },
      ],
    };
    const next = mergeEntry(senna, d, chosen, previous);
    expect(next.photos.map((p) => [p.file, p.match])).toEqual([
      ['File:Manual.jpg', 'manual'],
      ['File:B.jpg', 'auto'],
      ['File:A.jpg', 'rejected'],
    ]);
  });
});

describe('escopo', () => {
  it('senna: Senna, os companheiros e os carros (chassis da temporada)', () => {
    const targets = targetsFor(
      {
        driver: [
          { id: 'ayrton-senna', name: 'Ayrton Senna', date_of_birth: '1960-03-21' },
          { id: 'alain-prost', name: 'Alain Prost', date_of_birth: '1955-02-24' },
          { id: 'niki-lauda', name: 'Niki Lauda', date_of_birth: '1949-02-22' },
        ],
        constructor: [{ id: 'mclaren', name: 'McLaren' }],
        chassis: [{ id: 'mclaren-mp4-4', full_name: 'McLaren MP4/4' }],
        season_entrant_driver: [
          { year: 1988, constructor_id: 'mclaren', driver_id: 'ayrton-senna', test_driver: 0 },
          { year: 1988, constructor_id: 'mclaren', driver_id: 'alain-prost', test_driver: 0 },
          { year: 1984, constructor_id: 'mclaren', driver_id: 'niki-lauda', test_driver: 0 },
        ],
        season_entrant_chassis: [{ year: 1988, constructor_id: 'mclaren', chassis_id: 'mclaren-mp4-4' }],
      },
      'senna',
    );
    expect(
      targets.map((t) => (t.kind === 'driver' ? t.f1dbId : `${t.f1dbId}/${t.year}:${t.chassis.join()}`)),
    ).toEqual(['ayrton-senna', 'alain-prost', 'mclaren/1988:McLaren MP4/4']);
  });
});

describe('uma versão por foto', () => {
  it('original e recortes da Commons viram a mesma base', () => {
    const titles = [
      'File:Ayrton Senna 1989 Belgian GP podium.jpg',
      'File:Ayrton Senna 1989 Belgian GP podium (cropped2).jpg',
      'File:Senna 1992 Monaco cropped 2.jpg',
      'File:Ayrton Senna in the paddock before the 1993 British Grand Prix (33686752075) (cropped).jpg',
    ];
    expect(titles.map(photoBase)).toEqual([
      'ayrton senna 1989 belgian gp podium',
      'ayrton senna 1989 belgian gp podium',
      'senna 1992 monaco',
      'ayrton senna in the paddock before the 1993 british grand prix',
    ]);
  });

  it('a escolha não repete a mesma foto em duas versões', () => {
    const d: Discovery = {
      target: senna,
      wikidata: null,
      category: 'Ayrton Senna',
      note: null,
      candidates: [
        {
          file: file('File:Senna 1992 Monaco.jpg'),
          season: 1992,
          wikidataImage: false,
          portraitCategory: false,
        },
        {
          file: file('File:Senna 1992 Monaco cropped.jpg'),
          season: 1992,
          wikidataImage: false,
          portraitCategory: false,
        },
      ],
    };
    expect(choose(d, eligible(d).ok, null)).toHaveLength(1);
  });
});

describe('passo do Gemini (ranqueador falso)', () => {
  const files = [
    file('File:Senna Imola 1989.jpg', { width: 2400, height: 1600 }),
    file('File:Senna Monaco 1990.jpg', { width: 2000, height: 1500 }),
    file('File:Senna Interlagos 1991.jpg', { width: 1800, height: 1200 }),
  ];
  const discover = async (): Promise<Discovery> => ({
    target: senna,
    wikidata: 'Q10490',
    category: 'Ayrton Senna',
    note: null,
    candidates: files.map((f) => ({ file: f, season: null, wikidataImage: false, portraitCategory: false })),
  });
  const client = {
    download: async () => ({ body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
  } as unknown as WikimediaClient;
  /** Ranqueador falso: a de Interlagos não é foto real (ilustração); a de Mônaco é a melhor. */
  const fake = () => {
    const calls: string[][] = [];
    const ranker: Ranker = {
      model: 'gemini-fake',
      rank: async (images) => {
        calls.push(images.map((i) => i.title));
        return images.map((img, index) => ({
          index,
          kind: 'action' as const,
          keep: !img.title.includes('Interlagos'),
          quality: img.title.includes('Monaco') ? 9 : 5,
        }));
      },
    };
    return { ranker, calls };
  };
  const files_ = (e: ManifestEntry | undefined) => e?.photos.map((p) => [p.file, p.selected_by]);

  it('só as fotos que o Gemini manteve, na ordem dele, com o modelo e a data registrados', async () => {
    const { ranker, calls } = fake();
    const { manifest, stats } = await mapCommons(client, [senna], null, {
      revision: '2026-10-23',
      ranker,
      discover,
    });
    expect(calls).toHaveLength(1);
    const entry = manifest.entries[0]!;
    expect(files_(entry)).toEqual([
      ['File:Senna Monaco 1990.jpg', 'gemini'],
      ['File:Senna Imola 1989.jpg', 'gemini'],
    ]);
    expect(entry.ranking).toEqual({ by: 'gemini', model: 'gemini-fake', at: '2026-10-23', pool: 3 });
    expect(stats[0]!.ranking).toBe('gemini');
  });

  it('idempotente: alvo já ordenado não chama o Gemini de novo nem muda, e as regras não desfazem a ordem', async () => {
    const first = fake();
    const { manifest } = await mapCommons(client, [senna], null, {
      revision: '2026-10-23',
      ranker: first.ranker,
      discover,
    });
    const again = fake();
    const second = await mapCommons(client, [senna], manifest, {
      revision: '2026-10-24',
      ranker: again.ranker,
      discover,
    });
    expect(again.calls).toHaveLength(0);
    expect(second.manifest.entries).toEqual(manifest.entries);
    expect(second.stats[0]!.ranking).toBe('já ordenado');
    const rules = await mapCommons(client, [senna], manifest, { revision: '2026-10-24', discover });
    expect(rules.manifest.entries).toEqual(manifest.entries);
    // --refazer: ordena de novo
    const redo = fake();
    await mapCommons(client, [senna], manifest, {
      revision: '2026-10-24',
      ranker: redo.ranker,
      redo: true,
      discover,
    });
    expect(redo.calls).toHaveLength(1);
  });

  it('Gemini fora: o alvo fica como estava (sem ordem) e volta na próxima execução', async () => {
    const rulesOnly = await mapCommons(client, [senna], null, { revision: '2026-10-22', discover });
    const before = rulesOnly.manifest.entries[0]!;
    expect(before.ranking).toBeUndefined();
    expect(before.photos.every((p) => p.selected_by === 'rules')).toBe(true);
    const failing: Ranker = {
      model: 'gemini-fake',
      rank: async () => {
        throw new Error('PERMISSION_DENIED');
      },
    };
    const { manifest, stats } = await mapCommons(client, [senna], rulesOnly.manifest, {
      revision: '2026-10-23',
      ranker: failing,
      discover,
    });
    expect(manifest.entries).toEqual([before]);
    expect(stats[0]!.ranking).toBe('gemini falhou');
  });

  it('Gemini falhando em sequência: o lote para depois de 3 falhas seguidas, sem buscar os alvos seguintes', async () => {
    const targets = ['a', 'b', 'c', 'd'].map((id): DriverTarget => ({
      ...senna,
      f1dbId: `piloto-${id}`,
      name: `Piloto ${id}`,
      highlight: null,
    }));
    let calls = 0;
    const failing: Ranker = {
      model: 'gemini-fake',
      rank: async () => {
        calls++;
        throw new Error('RESOURCE_EXHAUSTED');
      },
    };
    const counted = vi.fn(discover);
    const { manifest, stats } = await mapCommons(client, targets, null, {
      revision: '2026-10-26',
      ranker: failing,
      discover: counted,
    });
    expect(calls).toBe(3);
    expect(counted).toHaveBeenCalledTimes(3);
    expect(manifest.entries).toEqual([]);
    expect(stats.at(-1)).toMatchObject({
      ranking: 'gemini falhou',
      note: 'pendente: Gemini falhou 3 vezes seguidas',
    });
  });

  it('nenhum julgamento para as fotos enviadas: o alvo não vira ordenado sem fotos', async () => {
    const none: Ranker = { model: 'gemini-fake', rank: async () => [] };
    const { manifest, stats } = await mapCommons(client, [senna], null, {
      revision: '2026-10-26',
      ranker: none,
      discover,
    });
    expect(manifest.entries).toEqual([]);
    expect(stats[0]!.ranking).toBe('gemini falhou');
  });

  it('sem orçamento de IA (ou IA desligada): para de ordenar e os alvos seguintes nem buscam candidatas', async () => {
    const prost: DriverTarget = { ...senna, f1dbId: 'alain-prost', name: 'Alain Prost', highlight: null };
    const noBudget: Ranker = {
      model: 'gemini-fake',
      rank: async () => {
        throw new AiDisabledError('global');
      },
    };
    const counted = vi.fn(discover);
    const { manifest, stats } = await mapCommons(client, [senna, prost], null, {
      revision: '2026-10-26',
      ranker: noBudget,
      discover: counted,
    });
    expect(counted).toHaveBeenCalledTimes(1);
    expect(manifest.entries).toEqual([]);
    expect(stats.map((s) => s.ranking)).toEqual(['sem orçamento de IA', 'sem orçamento de IA']);
    expect(stats[1]!.note).toMatch(/^pendente: IA desligada/);
  });

  it('descoberta vazia (identidade não conferida) não apaga a galeria já mapeada: fica como estava', async () => {
    const mapped = await mapCommons(client, [senna], null, { revision: '2026-10-22', discover });
    const before = mapped.manifest.entries[0]!;
    expect(before.photos.length).toBeGreaterThan(0);
    const vazia = async () => ({
      target: senna,
      wikidata: null,
      category: null,
      candidates: [],
      note: 'sem item conferido no Wikidata',
    });
    const { manifest, stats } = await mapCommons(client, [senna], mapped.manifest, {
      revision: '2026-10-25',
      discover: vazia,
    });
    expect(manifest.entries).toEqual([before]);
    expect(stats[0]!.note).toBe('pendente: descoberta vazia (sem item conferido no Wikidata)');
    // sem galeria antes, a descoberta vazia entra como sempre (o alvo fica sem fotos)
    const fresh = await mapCommons(client, [senna], null, { revision: '2026-10-25', discover: vazia });
    expect(fresh.manifest.entries[0]!.photos).toEqual([]);
  });
});
