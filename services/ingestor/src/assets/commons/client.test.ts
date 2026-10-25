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
