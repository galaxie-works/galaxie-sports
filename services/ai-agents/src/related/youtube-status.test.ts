import { describe, expect, it, vi } from 'vitest';
import { YoutubeClient, YoutubeDisabledError, YOUTUBE_OFF_MESSAGE, youtubeStatus } from './youtube.js';

describe('YOUTUBE_SEARCH (chave geral do YouTube)', () => {
  it('sem a variável, ou vazia, fica ligado: a produção não muda', () => {
    expect(youtubeStatus({})).toBe('on');
    expect(youtubeStatus({ YOUTUBE_SEARCH: '' })).toBe('on');
    expect(youtubeStatus({ YOUTUBE_SEARCH: '   ' })).toBe('on');
  });

  it('on e off, sem diferença de caixa nem de espaços', () => {
    expect(youtubeStatus({ YOUTUBE_SEARCH: 'on' })).toBe('on');
    expect(youtubeStatus({ YOUTUBE_SEARCH: 'off' })).toBe('off');
    expect(youtubeStatus({ YOUTUBE_SEARCH: ' OFF ' })).toBe('off');
  });

  it('valor desconhecido falha em vez de ligar por engano', () => {
    expect(() => youtubeStatus({ YOUTUBE_SEARCH: 'of' })).toThrow(/YOUTUBE_SEARCH inválido: "of"/);
    expect(() => youtubeStatus({ YOUTUBE_SEARCH: 'false' })).toThrow(/use on ou off/);
  });

  it('o cliente não nasce com o YouTube desligado: nenhuma chamada sai', async () => {
    const fetch = vi.fn();
    expect(() => new YoutubeClient({ apiKey: 'k', fetch, env: { YOUTUBE_SEARCH: 'off' } })).toThrow(
      YoutubeDisabledError,
    );
    expect(() => new YoutubeClient({ apiKey: 'k', fetch, env: { YOUTUBE_SEARCH: 'off' } })).toThrow(
      YOUTUBE_OFF_MESSAGE,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ligado (ou sem a variável), o cliente chama a Data API como antes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const client = new YoutubeClient({ apiKey: 'k', fetch, env: { YOUTUBE_SEARCH: 'on' } });
    await client.videos(['v1']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.units).toBe(1);
  });
});
