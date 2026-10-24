import { describe, expect, it } from 'vitest';
import { loadWtwConfig } from '../config/loader.js';
import { aiBatches, channelMatchInput, channelMatchSchema, validateAiMatches, type AiBatch } from './ai.js';
import { analyzeChannel } from './analyze.js';
import { FIXTURE_EXPECTED, FIXTURE_UNMATCHED, fixtureChannels, fixtureRights } from './fixture.js';
import { ChannelDictionary, resolveChannels, universeRights } from './match.js';
import { ChannelListError, parseChannelList } from './parse.js';
import { clientChannelKey, processChannelList } from './process.js';
import { rightKey, type RightMatch } from './types.js';

const config = loadWtwConfig({ env: {} });
const dict = new ChannelDictionary(config);
const ch = (name: string, idx = 0, group: string | null = null) => ({ idx, name, group });

/** A IA como o Gemini respondeu no AI Studio para as sobras: nenhum canal para os streamings. */
const geminiLike = async (batch: AiBatch) => ({
  transmissores: batch.rights.map((_, i) => ({
    direito_idx: i,
    canal_cliente_idx: null,
    casamento: 'sem_canal_na_lista',
    nota_auditoria: null,
  })),
});

const byKey = (matches: RightMatch[]) => new Map(matches.map((m) => [rightKey(m), m]));

describe('normalização do nome do canal', () => {
  it('tira país, praça, qualidade e feed', () => {
    const f = analyzeChannel(ch('BR: |SP| GLOBO HD'));
    expect(f).toMatchObject({
      country: 'BR',
      countryFrom: 'nome',
      praca: 'SP',
      quality: 'HD',
      base: 'GLOBO',
      vod: false,
    });
    expect(analyzeChannel(ch('GLOBO RJ'))).toMatchObject({ country: null, praca: 'RJ', brand: 'GLOBO' });
    expect(analyzeChannel(ch('ARG: FOX SPORTS 2 HD'))).toMatchObject({
      country: 'AR',
      feed: '2',
      brand: 'FOX SPORTS 2',
      brandNoFeed: 'FOX SPORTS',
    });
    expect(analyzeChannel(ch('MEX | ESPN 3 FHD'))).toMatchObject({
      country: 'MX',
      feed: '3',
      quality: 'FHD',
    });
    expect(analyzeChannel(ch('[COL] WIN SPORTS +'))).toMatchObject({ country: 'CO', base: 'WIN SPORTS+' });
    expect(analyzeChannel(ch('CHI: TNT SPORTS ᴴᴰ'))).toMatchObject({
      country: 'CL',
      quality: 'HD',
      base: 'TNT SPORTS',
    });
  });

  it('VOD, pan-regional, país por extenso e país do grupo do M3U', () => {
    expect(analyzeChannel(ch('MX: MAX VOD')).vod).toBe(true);
    expect(analyzeChannel(ch('LATAM: ESPN HD'))).toMatchObject({ pan: true, country: null });
    expect(analyzeChannel(ch('ESPN 2 LATAM'))).toMatchObject({
      pan: true,
      country: null,
      feed: '2',
      brandNoFeed: 'ESPN',
    });
    expect(analyzeChannel(ch('FOX SPORTS ARGENTINA'))).toMatchObject({ country: 'AR', brand: 'FOX SPORTS' });
    expect(analyzeChannel(ch('ESPN', 0, 'CHILE | DEPORTES'))).toMatchObject({
      country: 'CL',
      countryFrom: 'grupo',
    });
    expect(analyzeChannel(ch('ESPN'), 'CO')).toMatchObject({ country: 'CO', countryFrom: 'lista' });
    // "PE" como prefixo é o Peru; no fim do nome de um canal do Brasil é a praça (Pernambuco)
    expect(analyzeChannel(ch('PE: AMERICA TV'))).toMatchObject({ country: 'PE' });
    expect(analyzeChannel(ch('BR: GLOBO PE'))).toMatchObject({ country: 'BR', praca: 'PE', brand: 'GLOBO' });
  });

  it('marca de um país só, sem prefixo, fica com o país da marca', () => {
    const [globo, espn] = resolveChannels(
      [analyzeChannel(ch('GLOBO RJ')), analyzeChannel(ch('ESPN HD', 1))],
      dict,
    );
    expect(globo!.country).toBe('BR');
    expect(espn!.country).toBeNull();
  });
});

describe('lista do cliente (M3U ou nomes colados)', () => {
  it('lê só o nome e o grupo do M3U: URL, tvg-id e logo ficam de fora', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="globo.sp" tvg-logo="http://logo.example/g.png" group-title="BRASIL",BR: |SP| GLOBO HD',
      'http://stream.example/live/1.ts',
      '#EXTINF:-1 tvg-name="ESPN, o canal" group-title="ESPORTES",ESPN HD',
      'http://stream.example/live/2.ts',
      '#EXTINF:-1 group-title="BRASIL",BR: |SP| GLOBO HD',
      'http://stream.example/live/3.ts',
    ].join('\n');
    const parsed = parseChannelList(m3u);
    expect(parsed.format).toBe('m3u');
    expect(parsed.channels).toEqual([
      { idx: 0, name: 'BR: |SP| GLOBO HD', group: 'BRASIL' },
      { idx: 1, name: 'ESPN HD', group: 'ESPORTES' },
    ]);
    expect(parsed.duplicates).toBe(1);
    expect(JSON.stringify(parsed)).not.toMatch(/stream\.example|logo\.example|globo\.sp/);
  });

  it('nomes colados, um por linha (URLs e comentários ignorados)', () => {
    const parsed = parseChannelList('GLOBO SP\n\n  ESPN HD  \nhttp://x.example/1\n# comentário\n');
    expect(parsed.format).toBe('text');
    expect(parsed.channels.map((c) => c.name)).toEqual(['GLOBO SP', 'ESPN HD']);
    expect(() => parseChannelList('   \n')).toThrow(ChannelListError);
  });
});

describe('exemplo de referência: Palmeiras × Fluminense', () => {
  const rights = fixtureRights(config);

  it('casa como o esperado com a IA nas sobras', async () => {
    const res = await processChannelList({ channels: fixtureChannels(), rights, dict }, geminiLike);
    expect(res.violations).toEqual([]);
    const got = byKey(res.matches);
    expect(res.matches).toHaveLength(rights.length); // todo direito volta exatamente uma vez
    for (const [key, exp] of Object.entries(FIXTURE_EXPECTED))
      expect({ key, match: got.get(key)?.match, channels: got.get(key)?.channels }).toEqual({ key, ...exp });
    expect(got.get('CL:chilevision')!.note).toMatch(/SPORTS/);
    const used = new Set(res.matches.flatMap((m) => m.channels));
    for (const idx of FIXTURE_UNMATCHED) expect(used.has(idx)).toBe(false);
  });

  it('no exemplo, o código decide tudo: nenhuma sobra tem par possível e a IA nem é chamada', async () => {
    const res = await processChannelList({ channels: fixtureChannels(), rights, dict });
    expect(res.batches).toEqual([]);
    const origins = byKey(res.matches);
    expect(origins.get('BR:globo')!.origin).toBe('codigo');
    expect(origins.get('CL:espn')!.origin).toBe('codigo');
    expect(origins.get('MX:hbo_max')).toMatchObject({ match: 'sem_canal_na_lista', origin: 'codigo' });
  });

  it('a IA só vê os pares com palavra de marca em comum, sem VOD nem canal de outra emissora', async () => {
    const channels = [
      ...fixtureChannels(),
      { idx: 11, name: 'MX: HBO MAX EVENTOS', group: null },
      { idx: 12, name: 'CARTOON NETWORK', group: null },
    ];
    const res = await processChannelList({ channels, rights, dict });
    const origins = byKey(res.matches);
    expect(origins.get('BR:globo')!.origin).toBe('codigo');
    const sent = res.batches.flatMap((b) => b.rights.map((r) => rightKey(r))).sort();
    expect(sent).toEqual(['MX:hbo_max']);
    const sentChannels = res.batches.flatMap((b) => b.channels.map((c) => c.facts.idx));
    // "MX: MAX VOD" (6) é VOD, "MX: TNT SPORTS HD" (7) é de outra emissora, Cartoon (12) não divide marca
    expect(sentChannels).toEqual([11]);
    // entrada da IA: direitos e canais numerados, só índices e enums na saída
    const mx = res.batches.find((b) => b.country === 'MX')!;
    // mensagem no molde validado: direitos numerados (acesso do dicionário) e canais indexados
    const message = channelMatchInput(mx);
    expect(message).toContain('0: país "MX" | plataforma_id "hbo_max" | acesso "streaming_assinatura"');
    expect(message).toContain('11: "MX: HBO MAX EVENTOS"');
    expect(message).not.toMatch(/CARTOON|MAX VOD/);
    const schema = channelMatchSchema(mx) as {
      properties: { transmissores: { items: { properties: Record<string, { enum?: unknown[] }> } } };
    };
    const props = schema.properties.transmissores.items.properties;
    expect(props.direito_idx!.enum).toEqual([0]);
    expect(props.canal_cliente_idx!.enum).toContain(null);
    expect(props.canal_cliente_idx!.enum).not.toContain(6);
  });

  it('sem IA, as sobras ficam sem canal (o resultado esperado não depende dela)', async () => {
    const res = await processChannelList({ channels: fixtureChannels(), rights, dict });
    const got = byKey(res.matches);
    for (const [key, exp] of Object.entries(FIXTURE_EXPECTED)) expect(got.get(key)?.match).toBe(exp.match);
  });
});

describe('praça não é modelada', () => {
  it('Globo SP e Globo RJ na mesma lista: os dois exato com a Globo', async () => {
    const channels = ['BR: |SP| GLOBO HD', 'GLOBO RJ', 'BR | GLOBO MINAS FHD', 'RBS TV', 'GLOBONEWS'].map(
      (n, i) => ch(n, i),
    );
    const rights = universeRights(config, ['BR']).filter((r) => r.broadcasterId === 'globo');
    const res = await processChannelList({ channels, rights, dict });
    expect(res.matches).toEqual([
      expect.objectContaining({
        country: 'BR',
        broadcasterId: 'globo',
        match: 'exato',
        channels: [0, 1, 2, 3],
      }),
    ]);
  });
});

describe('validador depois da IA', () => {
  const rights = fixtureRights(config);
  const channels = resolveChannels(
    fixtureChannels().map((c) => analyzeChannel(c)),
    dict,
  );
  const cl: AiBatch = {
    country: 'CL',
    rights: rights.filter((r) => r.country === 'CL'),
    channels,
    omittedChannels: 0,
  };
  const item = (
    direito_idx: number,
    canal_cliente_idx: number | null,
    casamento: string,
    nota: string | null = null,
  ) => ({
    direito_idx,
    canal_cliente_idx,
    casamento,
    nota_auditoria: nota,
  });

  it('cada violação vira sem_canal_na_lista com nota', () => {
    // CL: 0 = chilevision, 1 = espn, 2 = paramount_plus
    const { matches, violations } = validateAiMatches(
      cl,
      {
        transmissores: [
          item(0, 99, 'exato'), // índice fora da lista
          item(1, 3, 'exato'), // canal da Argentina como exato
          item(1, 5, 'feed_generico'), // e o direito voltou duas vezes
          item(2, 4, 'exato'), // streaming exato com canal linear
        ],
      },
      dict,
    );
    expect(matches.map((m) => m.match)).toEqual([
      'sem_canal_na_lista',
      'sem_canal_na_lista',
      'sem_canal_na_lista',
    ]);
    expect(matches.every((m) => m.origin === 'ia' && m.note?.startsWith('Validador:'))).toBe(true);
    expect(violations.join('\n')).toMatch(/fora da lista/);
    expect(violations.join('\n')).toMatch(/voltou 2 vezes/);
    expect(violations.join('\n')).toMatch(/streaming/);
  });

  it('VOD, outra emissora e direito ausente também são recusados', () => {
    const { matches, violations } = validateAiMatches(
      cl,
      { transmissores: [item(0, 6, 'nome_divergente', 'x'), item(1, 7, 'feed_generico')] },
      dict,
    );
    expect(matches.map((m) => m.match)).toEqual([
      'sem_canal_na_lista',
      'sem_canal_na_lista',
      'sem_canal_na_lista',
    ]);
    expect(violations.join('\n')).toMatch(/VOD/);
    expect(violations.join('\n')).toMatch(/outra emissora \(tnt_sports\)/);
    expect(violations.join('\n')).toMatch(/não voltou/);
  });

  it('aceita o que segue as regras e só guarda nota na divergência', () => {
    const { matches, violations } = validateAiMatches(
      cl,
      {
        transmissores: [
          item(0, 4, 'nome_divergente', '  Sufixo  SPORTS  '),
          item(1, 5, 'feed_generico', 'ignorada'),
          item(2, null, 'sem_canal_na_lista'),
        ],
      },
      dict,
    );
    expect(violations).toEqual([]);
    expect(matches.map((m) => [m.match, m.channels, m.note])).toEqual([
      ['nome_divergente', [4], 'Sufixo SPORTS'],
      ['feed_generico', [5], 'ignorada'],
      ['sem_canal_na_lista', [], null],
    ]);
  });

  it('texto livre no lugar do enum não passa ("Paramount并发")', () => {
    const { matches } = validateAiMatches(cl, { transmissores: [item(2, 4, 'Paramount并发')] }, dict);
    expect(matches[2]!.match).toBe('sem_canal_na_lista');
  });
});

describe('correções do cliente', () => {
  it('vencem o código e não vão para a IA', async () => {
    const rights = fixtureRights(config);
    const res = await processChannelList({
      channels: fixtureChannels(),
      rights,
      dict,
      overrides: [
        {
          country: 'CL',
          broadcasterId: 'chilevision',
          channelKeys: [clientChannelKey('CL: CHILEVISION SPORTS')],
        },
        { country: 'BR', broadcasterId: 'globo', channelKeys: [] },
        { country: 'MX', broadcasterId: 'hbo_max', channelKeys: [clientChannelKey('ESPN 2 LATAM')] },
      ],
    });
    const got = byKey(res.matches);
    expect(got.get('CL:chilevision')).toMatchObject({ match: 'exato', channels: [4], origin: 'cliente' });
    expect(got.get('BR:globo')).toMatchObject({ match: 'sem_canal_na_lista', origin: 'cliente' });
    expect(got.get('MX:hbo_max')).toMatchObject({ match: 'feed_generico', channels: [5], origin: 'cliente' });
    expect(res.batches.flatMap((b) => b.rights.map(rightKey))).not.toContain('MX:hbo_max');
  });
});

describe('universo de direitos', () => {
  it('cada emissora de cada país é um direito, com o acesso do dicionário', () => {
    const rights = universeRights(config, ['BR', 'CL']);
    expect(rights.map((r) => r.idx)).toEqual(rights.map((_, i) => i));
    expect(rights.find((r) => r.country === 'BR' && r.broadcasterId === 'globoplay')?.access).toBe(
      'streaming',
    );
    expect(rights.find((r) => r.country === 'CL' && r.broadcasterId === 'chilevision')?.access).toBe(
      'linear',
    );
    expect(aiBatches([], [])).toEqual([]);
  });
});
