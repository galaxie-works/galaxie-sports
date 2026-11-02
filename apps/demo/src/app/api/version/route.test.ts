import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPublicPath } from '@/lib/public-routes';

import { GET } from './route';

vi.mock('next/server', () => ({ connection: async () => undefined }));

describe('/api/version', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('responde o hash da imagem', async () => {
    vi.stubEnv('GALAXIE_IMAGE_HASH', 'in-abc');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ service: 'demo', image_hash: 'in-abc', node: process.version });
    expect(new Date(body.started_at).getTime()).not.toBeNaN();
  });

  it('fora de imagem é dev', async () => {
    vi.stubEnv('GALAXIE_IMAGE_HASH', '');
    expect((await (await GET()).json()).image_hash).toBe('dev');
  });

  it('abre sem sessão', () => {
    expect(isPublicPath('/api/version')).toBe(true);
    expect(isPublicPath('/api/version/x')).toBe(false);
  });
});
