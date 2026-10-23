import { DEFAULT_THEMES } from '@galaxie/widgets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWidget = vi.fn();
vi.mock('@/lib/builder/store', () => ({
  builderDb: () => ({}),
  getWidget: (...a: unknown[]) => getWidget(...a),
}));

const { GET } = await import('./route');

const ID = '01a16029-9283-77d0-b2e5-1d89336b2dbc';
const EVENT = '01a163b8-7ca2-71e8-a92e-8dc201d5d83a';

const widget = (over: Record<string, unknown> = {}) => ({
  id: ID,
  tenantId: '01a16029-0000-7000-8000-000000000001',
  kind: 'match_card',
  name: 'Placar Operadora Exemplo',
  version: 3,
  config: { theme: DEFAULT_THEMES.sunset, locale: 'pt-BR', market: 'BR', defaults: { eventId: EVENT } },
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  ...over,
});

const call = (param: string) =>
  GET(new Request(`http://localhost/r/${param}`), { params: Promise.resolve({ id: param }) } as never);

describe('rota pública /r/[id].json', () => {
  beforeEach(() => getWidget.mockReset());

  it('devolve o registry-item do widget com o tema dele, sem chave nenhuma', async () => {
    getWidget.mockResolvedValue(widget());
    const res = await call(`${ID}.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.text();
    const item = JSON.parse(body);
    expect(item.$schema).toContain('registry-item');
    expect(item.name).toBe('placar-operadora-exemplo');
    expect(body).toContain(DEFAULT_THEMES.sunset.primary);
    expect(body).toContain(EVENT);
    expect(body).not.toMatch(/gs_pk_live_[A-Za-z0-9_-]{8}/);
    expect(body).not.toContain('x-galaxie-key');
    expect(getWidget).toHaveBeenCalledWith(expect.anything(), ID);
  });

  it('widget arquivado ou inexistente: 404', async () => {
    getWidget.mockResolvedValue(widget({ archivedAt: new Date() }));
    expect((await call(`${ID}.json`)).status).toBe(404);
    getWidget.mockResolvedValue(null);
    expect((await call(`${ID}.json`)).status).toBe(404);
  });

  it('id fora do formato nem chega ao banco', async () => {
    for (const param of ['abc.json', ID, `${ID}.js`]) expect((await call(param)).status).toBe(404);
    expect(getWidget).not.toHaveBeenCalled();
  });

  it('configuração que o gerador recusa não vira item quebrado', async () => {
    getWidget.mockResolvedValue(widget({ config: { ...widget().config, market: 'BRA' } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(`${ID}.json`)).status).toBe(422);
  });
});
