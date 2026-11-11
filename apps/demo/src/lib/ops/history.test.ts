import { beforeEach, describe, expect, it, vi } from 'vitest';

// a leitura do histórico fala com o Postgres pelo pool do console: aqui só conferimos o SQL e os parâmetros
const poolQuery = vi.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[] }));
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));

const { readHistory } = await import('./data');

beforeEach(() => poolQuery.mockClear());

describe('histórico de ajustes', () => {
  it('sem chave: as 100 mudanças mais recentes de todas as chaves', async () => {
    await readHistory();
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).not.toContain('where');
    expect(sql).toContain('limit 100');
    expect(params).toEqual([]);
  });

  it('com `?chave=`: o filtro vai no banco, parametrizado (não só nas 100 mais recentes de todas)', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          key: 'POSTGAME_FOOTBALL',
          action: 'set',
          old_value: null,
          new_value: 'off',
          changed_by: 'ana',
          changed_at: new Date('2026-11-11T12:00:00Z'),
        },
      ],
    });
    const rows = await readHistory("POSTGAME_FOOTBALL' or 1=1 --");
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).toMatch(/where key = any\(\$1\) order by changed_at desc, id desc limit 100/);
    expect(sql).not.toContain('POSTGAME_FOOTBALL');
    expect(params).toEqual([["POSTGAME_FOOTBALL' or 1=1 --"]]);
    expect(rows).toEqual([
      {
        id: 7,
        key: 'POSTGAME_FOOTBALL',
        action: 'set',
        oldValue: null,
        newValue: 'off',
        changedBy: 'ana',
        changedAt: '2026-11-11T12:00:00.000Z',
      },
    ]);
  });

  it('chave trocada no painel (#1087): o histórico inclui a linha cifrada, mostrada como a chave, sem valor', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: '9',
          key: 'APISPORTS_KEY_SEALED',
          action: 'set',
          old_value: null,
          new_value: '••••••••',
          changed_by: 'ana',
          changed_at: new Date('2026-11-11T12:00:00Z'),
        },
      ],
    });
    const rows = await readHistory('APISPORTS_KEY');
    expect(poolQuery.mock.calls[0]![1]).toEqual([['APISPORTS_KEY', 'APISPORTS_KEY_SEALED']]);
    expect(rows[0]).toMatchObject({ key: 'APISPORTS_KEY', newValue: '••••••••', changedBy: 'ana' });
  });
});
