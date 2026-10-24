import { describe, expect, it } from 'vitest';

import { stripStreamUrls, unmatchedChannels } from './types';

describe('lista de canais no navegador', () => {
  it('corta as URLs de stream do M3U antes do envio', () => {
    const m3u =
      '#EXTM3U\n#EXTINF:-1 group-title="BR",GLOBO SP\nhttp://stream.example/1.ts\n#EXTINF:-1,ESPN\nrtmp://x/2';
    expect(stripStreamUrls(m3u)).toBe('#EXTM3U\n#EXTINF:-1 group-title="BR",GLOBO SP\n#EXTINF:-1,ESPN');
    expect(stripStreamUrls('GLOBO SP\nESPN HD')).toBe('GLOBO SP\nESPN HD');
  });

  it('canais sem emissora', () => {
    const channels = [0, 1, 2].map((idx) => ({ idx, name: `C${idx}`, group: null }));
    const rights = [{ channels: [0, 2] }] as never;
    expect(unmatchedChannels({ channels, rights }).map((c) => c.idx)).toEqual([1]);
  });
});
