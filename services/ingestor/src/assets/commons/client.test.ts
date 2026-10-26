import { describe, expect, it } from 'vitest';
import { WikimediaClient } from './client.js';

describe('WikimediaClient.items', () => {
  it('rótulo e descrição na primeira língua, nomes sem repetição e só as afirmações pedidas', async () => {
    const urls: URL[] = [];
    const client = new WikimediaClient({
      minIntervalMs: 0,
      fetch: async (url) => {
        urls.push(new URL(String(url)));
        return new Response(
          JSON.stringify({
            entities: {
              Q214940: {
                labels: {
                  en: { value: 'Estudiantes de La Plata' },
                  es: { value: 'Estudiantes de La Plata' },
                },
                aliases: { en: [{ value: 'Estudiantes LP' }], es: [{ value: 'Pincha' }] },
                descriptions: { en: { value: 'Argentine football club' } },
                claims: { P31: [{ mainsnak: {} }], P18: [{ mainsnak: {} }] },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const items = await client.items(['Q214940'], ['P31', 'P118'], ['en', 'es']);
    expect(items.get('Q214940')).toEqual({
      label: 'Estudiantes de La Plata',
      names: ['Estudiantes de La Plata', 'Estudiantes LP', 'Pincha'],
      description: 'Argentine football club',
      claims: { P31: [{ mainsnak: {} }], P118: [] },
    });
    expect(urls[0]!.searchParams.get('props')).toBe('labels|aliases|descriptions|claims');
    expect(urls[0]!.searchParams.get('languages')).toBe('en|es');
    expect(await client.items([], ['P31'])).toEqual(new Map());
  });

  it('resposta cortada pela API (> 12 MB) é refeita em metades; sem afirmações pedidas, não as busca', async () => {
    const calls: string[][] = [];
    const client = new WikimediaClient({
      minIntervalMs: 0,
      fetch: async (url) => {
        const u = new URL(String(url));
        const ids = u.searchParams.get('ids')!.split('|');
        calls.push(ids);
        // o lote de 4 volta cortado: só o primeiro item e o aviso
        const truncated = ids.length > 2;
        const entities = Object.fromEntries(
          (truncated ? ids.slice(0, 1) : ids).map((id) => [id, { labels: { en: { value: `país ${id}` } } }]),
        );
        return new Response(
          JSON.stringify({
            entities,
            ...(truncated
              ? {
                  warnings: {
                    result: { warnings: 'This result was truncated because it would otherwise be larger' },
                  },
                }
              : {}),
          }),
          { status: 200 },
        );
      },
    });
    const items = await client.items(['Q1', 'Q2', 'Q3', 'Q4'], []);
    expect([...items.keys()]).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(calls).toEqual([
      ['Q1', 'Q2', 'Q3', 'Q4'],
      ['Q1', 'Q2'],
      ['Q3', 'Q4'],
    ]);
  });
});

describe('WikimediaClient.extMetadata', () => {
  it('só os campos pedidos, em lotes de 50, pelo título original mesmo quando a Commons normaliza', async () => {
    const urls: URL[] = [];
    const client = new WikimediaClient({
      minIntervalMs: 0,
      fetch: async (url) => {
        const u = new URL(String(url));
        urls.push(u);
        const titles = u.searchParams.get('titles')!.split('|');
        return Response.json({
          query: {
            normalized: titles
              .filter((t) => t.includes('_'))
              .map((t) => ({ from: t, to: t.replaceAll('_', ' ') })),
            pages: titles
              .filter((t) => t !== 'File:Sumiu.svg')
              .map((t) => ({
                title: t.replaceAll('_', ' '),
                imageinfo: [{ extmetadata: { Attribution: { value: `de ${t}` } } }],
              })),
          },
        });
      },
    });
    const titles = [
      'File:Logo_Exemplo.svg',
      'File:Sumiu.svg',
      ...Array.from({ length: 50 }, (_, i) => `File:L${i}.svg`),
    ];
    const metas = await client.extMetadata(titles, ['Attribution']);
    expect(urls).toHaveLength(2);
    expect(urls[0]!.searchParams.get('iiextmetadatafilter')).toBe('Attribution');
    expect(urls[0]!.searchParams.get('iiprop')).toBe('extmetadata');
    expect(metas.get('File:Logo_Exemplo.svg')).toEqual({
      Attribution: { value: 'de File:Logo_Exemplo.svg' },
    });
    expect(metas.has('File:Sumiu.svg')).toBe(false);
    expect(metas.size).toBe(51);
  });
});

describe('WikimediaClient.imageInfoReport', () => {
  it('devolve à parte os arquivos que a Commons diz não existirem (apagados ou título inválido)', async () => {
    const client = new WikimediaClient({
      minIntervalMs: 0,
      fetch: async () =>
        Response.json({
          query: {
            pages: [
              { title: 'File:Apagada.jpg', missing: true },
              { title: 'File:<inválido>', invalid: true },
              {
                title: 'File:Viva.jpg',
                imageinfo: [{ url: 'u', descriptionurl: 'd', width: 10, height: 10, mime: 'image/jpeg' }],
              },
            ],
          },
        }),
    });
    const r = await client.imageInfoReport(['File:Apagada.jpg', 'File:<inválido>', 'File:Viva.jpg'], 100);
    expect(r.missing).toEqual(['File:Apagada.jpg', 'File:<inválido>']);
    expect(r.files.map((f) => f.title)).toEqual(['File:Viva.jpg']);
  });
});

describe('WikimediaClient: rede instável', () => {
  const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

  it('erro de rede (ECONNRESET) é tentado de novo com espera; depois a resposta vale', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = new WikimediaClient({
      minIntervalMs: 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () => {
        calls += 1;
        if (calls <= 2) throw reset();
        return Response.json({ search: [{ id: 'Q1' }] });
      },
    });
    expect(await client.searchItems('Senna')).toEqual(['Q1']);
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it('esgotadas as tentativas, vira WikimediaError (a varredura trata como Wikimedia fora)', async () => {
    let calls = 0;
    const client = new WikimediaClient({
      minIntervalMs: 0,
      maxRetries: 2,
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        throw reset();
      },
    });
    await expect(client.download('https://upload.wikimedia.org/x.jpg')).rejects.toMatchObject({
      name: 'WikimediaError',
      message: expect.stringMatching(/falha de rede/),
    });
    expect(calls).toBe(3);
    await expect(client.entityClaims('Q1', ['P18'])).rejects.toMatchObject({ name: 'WikimediaError' });
  });

  it('conexão pendurada cai no tempo-limite e é tentada de novo, sem travar', async () => {
    let calls = 0;
    const client = new WikimediaClient({
      minIntervalMs: 0,
      timeoutMs: 20,
      sleep: async () => {},
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        // a primeira nunca responde: só o sinal de tempo-limite a encerra
        if (calls === 1)
          return new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
          );
        return Response.json({ search: [] });
      }) as typeof fetch,
    });
    expect(await client.searchItems('Senna')).toEqual([]);
    expect(calls).toBe(2);
  });
});
