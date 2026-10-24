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
});
