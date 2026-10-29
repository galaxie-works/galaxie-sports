import { EMBED_VERSION } from '@galaxie/widgets/embed-script';
import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('rota pública /embed.js', () => {
  it('serve o script do <galaxie-widget> como JavaScript, com ETag', async () => {
    const res = GET(new Request('http://localhost/embed.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('etag')).toBe(`"${EMBED_VERSION}"`);
    const body = await res.text();
    expect(body).toContain('galaxie-widget');
    expect(body).not.toMatch(/gs_pk_live_[A-Za-z0-9_-]{8}/);
  });

  it('com o mesmo ETag responde 304 sem corpo', async () => {
    const res = GET(
      new Request('http://localhost/embed.js', { headers: { 'if-none-match': `"${EMBED_VERSION}"` } }),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });
});
