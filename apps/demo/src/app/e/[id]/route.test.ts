import { DEFAULT_THEMES } from '@galaxie/widgets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWidget = vi.fn();
vi.mock('@/lib/builder/store', () => ({
  builderDb: () => ({}),
  getWidget: (...a: unknown[]) => getWidget(...a),
}));

const { GET } = await import('./route');

const ID = '01a16029-9283-77d0-b2e5-1d89336b2dbc';
const COMPETITION = '01a163b8-7ca2-71e8-a92e-8dc201d5d83a';

const widget = (over: Record<string, unknown> = {}) => ({
  id: ID,
  tenantId: '01a16029-0000-7000-8000-000000000001',
  kind: 'standings',
  name: 'Tabela brasileirão',
  version: 4,
  config: {
    theme: DEFAULT_THEMES.dark,
    locale: 'pt-BR',
    market: 'BR',
    defaults: { competitionId: COMPETITION },
  },
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  ...over,
});

const call = (param: string) =>
  GET(new Request(`http://localhost/e/${param}`), { params: Promise.resolve({ id: param }) } as never);

describe('rota pública /e/[id].json (embed HTML)', () => {
  beforeEach(() => getWidget.mockReset());

  it('devolve só a configuração pública do widget, aberta a qualquer origem', async () => {
    getWidget.mockResolvedValue(widget());
    const res = await call(`${ID}.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body).toMatchObject({
      id: ID,
      kind: 'standings',
      version: 4,
      locale: 'pt-BR',
      market: 'BR',
      defaults: { competitionId: COMPETITION },
      theme: DEFAULT_THEMES.dark,
    });
    expect(body.apiBaseUrl).toMatch(/^https:\/\//);
    // nada do tenant nem de quem criou
    expect(JSON.stringify(body)).not.toMatch(/tenant|createdBy|u1|gs_pk_/);
  });

  it('widget arquivado, inexistente ou id fora do formato: 404', async () => {
    getWidget.mockResolvedValue(widget({ archivedAt: new Date() }));
    expect((await call(`${ID}.json`)).status).toBe(404);
    getWidget.mockResolvedValue(null);
    expect((await call(`${ID}.json`)).status).toBe(404);
    getWidget.mockClear();
    for (const param of ['abc.json', ID, `${ID}.js`]) expect((await call(param)).status).toBe(404);
    expect(getWidget).not.toHaveBeenCalled();
  });
});
