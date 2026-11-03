import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@galaxie/db';
import { TaskError, type TaskDetail, type TaskRow } from '@galaxie/db/queue-admin';
import { age, runTarefaCli, type TarefaOps } from './cli.js';

const db = {} as Database;
const NOW = new Date('2026-11-02T12:00:00Z');

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    type: 'exemplo.eco',
    status: 'pending',
    params: { mensagem: 'oi', repeticoes: 3 },
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    checkpoint: null,
    lockedBy: null,
    lockedUntil: null,
    runAfter: NOW,
    requestedBy: 'cli:wagner@pc',
    requestedAt: new Date('2026-11-02T11:48:00Z'),
    pickedAt: null,
    finishedAt: null,
    runId: null,
    detail: null,
    lastError: null,
    approved: false,
    ...over,
  };
}

function setup(over: Partial<TarefaOps> = {}) {
  const ops: TarefaOps = {
    requestTask: vi.fn(async () => ({ id: 'nova', previa: false })),
    listTasks: vi.fn(async () => []),
    getTask: vi.fn(),
    cancelTask: vi.fn(async () => {}),
    reprocessTask: vi.fn(async () => ({ id: 'repro', previa: false })),
    ...over,
  };
  const out: string[] = [];
  const err: string[] = [];
  const run = (...argv: string[]) =>
    runTarefaCli(
      argv,
      db,
      { out: (l) => out.push(l), err: (l) => err.push(l), by: 'cli:teste', now: NOW },
      ops,
    );
  return { ops, out, err, run };
}

describe('gs tarefa enfileirar', () => {
  it('converte os --param pelo schema do tipo e passa prioridade, prévia e quem pediu', async () => {
    const { ops, out, run } = setup({
      requestTask: vi.fn(async () => ({ id: 'abc', previa: true })),
    });
    const code = await run(
      'enfileirar',
      'exemplo.eco',
      '--param',
      'mensagem=olá=mundo',
      '--param',
      'repeticoes=5',
      '--prioridade',
      '10',
      '--previa',
    );
    expect(code).toBe(0);
    expect(ops.requestTask).toHaveBeenCalledWith(
      db,
      {
        type: 'exemplo.eco',
        params: { mensagem: 'olá=mundo', repeticoes: 5 },
        priority: 10,
        previa: true,
        requestedBy: 'cli:teste',
      },
      expect.any(Array),
    );
    expect(out.join('\n')).toMatch(/Prévia abc na fila.*aprove no painel/);
  });

  it('--json devolve o resultado em JSON', async () => {
    const { out, run } = setup();
    expect(await run('enfileirar', 'exemplo.eco', '--param', 'mensagem=oi', '--json')).toBe(0);
    expect(JSON.parse(out.join('\n'))).toEqual({ id: 'nova', previa: false });
  });

  it('recusa da regra (destrutiva sem prévia, params inválidos) sai com 1 e a mensagem', async () => {
    const { err, out, run } = setup({
      requestTask: vi.fn(async () => {
        throw new TaskError('previa_obrigatoria', 'x apaga dados: enfileire em prévia (--previa).');
      }),
    });
    expect(await run('enfileirar', 'x', '--param', 'a=1')).toBe(1);
    expect(err).toEqual(['x apaga dados: enfileire em prévia (--previa).']);
    expect(await run('enfileirar', 'x', '--json')).toBe(1);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ error: 'previa_obrigatoria' });
  });

  it('uso errado sai com 2', async () => {
    const { err, run } = setup();
    expect(await run('enfileirar')).toBe(2);
    expect(await run('enfileirar', 'exemplo.eco', '--param', 'semigual')).toBe(1);
    expect(await run('enfileirar', 'exemplo.eco', '--prioridade', 'alta')).toBe(2);
    expect(await run('voar')).toBe(2);
    expect(await run('listar', '--nao-existe')).toBe(2);
    expect(err.join('\n')).toMatch(/--prioridade espera um número inteiro/);
  });
});

describe('gs tarefa listar', () => {
  it('mostra estado, prioridade, tentativas, idade, worker e progresso', async () => {
    const { ops, out, run } = setup({
      listTasks: vi.fn(async () => [
        row({
          status: 'running',
          attempts: 1,
          lockedBy: 'worker-1',
          checkpoint: { progresso: { feitos: 2, total: 3 } },
        }),
        row({
          id: '019a0000-0000-7000-8000-000000000002',
          status: 'done',
          params: { mensagem: 'oi', repeticoes: 3, previa: true },
          checkpoint: { previa: { contagens: { lotes: 3 }, amostra: [] } },
          requestedAt: new Date('2026-10-31T12:00:00Z'),
        }),
        row({ id: '019a0000-0000-7000-8000-000000000003', status: 'pending', runId: 'r' }),
      ]),
    });
    expect(await run('listar', '--status', 'pending,running,done', '--limite', '10')).toBe(0);
    expect(ops.listTasks).toHaveBeenCalledWith(db, { status: ['pending', 'running', 'done'], limit: 10 });
    const text = out.join('\n');
    expect(out[0]).toMatch(/^ID\s+TIPO\s+ESTADO\s+PRIOR\.\s+TENT\.\s+IDADE\s+WORKER\s+PROGRESSO$/);
    expect(text).toMatch(/rodando\s+0\s+1\/3\s+12 min\s+worker-1\s+2\/3/);
    expect(text).toMatch(/concluída, aguarda aprovação\s+0\s+0\/3\s+2 d/);
    expect(text).toMatch(/retomada/);
  });

  it('recusa status desconhecido e avisa quando não há nada', async () => {
    const { out, err, run } = setup();
    expect(await run('listar', '--status', 'feito')).toBe(2);
    expect(err.join('\n')).toMatch(/--status desconhecido: feito/);
    expect(await run('listar')).toBe(0);
    expect(out).toEqual(['Nenhuma tarefa.']);
  });
});

describe('gs tarefa ver', () => {
  it('mostra params, progresso, prévia, log, aprovações e execuções', async () => {
    const detail: TaskDetail = {
      ...row({
        status: 'done',
        params: { mensagem: 'oi', repeticoes: 3, previa: true },
        checkpoint: {
          previa: { resumo: 'Devolveria "oi"', contagens: { lotes: 3 }, amostra: ['oi'] },
          log: ['prévia: 3 lote(s)'],
        },
        finishedAt: NOW,
      }),
      runs: [
        {
          id: 'r1',
          status: 'interrupted',
          startedAt: new Date('2026-11-02T11:50:00Z'),
          finishedAt: null,
          error: null,
          resumedFrom: null,
          stats: null,
        },
        {
          id: 'r2',
          status: 'ok',
          startedAt: new Date('2026-11-02T11:55:00Z'),
          finishedAt: null,
          error: null,
          resumedFrom: 'r1',
          stats: null,
        },
      ],
      approvals: [],
      reprocesses: [],
    };
    const { out, run } = setup({ getTask: vi.fn(async () => detail) });
    expect(await run('ver', detail.id)).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/tipo\s+exemplo\.eco \(prévia\)/);
    expect(text).toMatch(/estado\s+concluída, aguarda aprovação/);
    expect(text).toMatch(/params\s+\{"mensagem":"oi","repeticoes":3\}/);
    expect(text).toMatch(/lotes: 3/);
    expect(text).toMatch(/aguarda "Aprovar e executar" no painel/);
    expect(text).toMatch(/prévia: 3 lote\(s\)/);
    expect(text).toMatch(/2026-11-02T11:55:00.000Z\s+ok \(retomada\)/);
  });

  it('tarefa que não existe sai com 1', async () => {
    const { err, run } = setup({
      getTask: vi.fn(async () => {
        throw new TaskError('nao_encontrada', 'Tarefa x não encontrada.');
      }),
    });
    expect(await run('ver', 'x')).toBe(1);
    expect(err).toEqual(['Tarefa x não encontrada.']);
    expect(await run('ver')).toBe(2);
  });
});

describe('gs tarefa cancelar e reprocessar', () => {
  it('cancelar passa quem pediu; recusa da que não está pendente sai com 1', async () => {
    const { ops, out, err, run } = setup();
    expect(await run('cancelar', 'abc')).toBe(0);
    expect(ops.cancelTask).toHaveBeenCalledWith(db, 'abc', 'cli:teste');
    expect(out).toEqual(['Tarefa abc cancelada.']);
    (ops.cancelTask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TaskError('nao_pendente', 'Só a tarefa pendente pode ser cancelada.'),
    );
    expect(await run('cancelar', 'abc')).toBe(1);
    expect(err).toEqual(['Só a tarefa pendente pode ser cancelada.']);
  });

  it('reprocessar avisa quando volta como prévia', async () => {
    const { ops, out, run } = setup({
      reprocessTask: vi.fn(async () => ({ id: 'nova', previa: true })),
    });
    expect(await run('reprocessar', 'velha')).toBe(0);
    expect(ops.reprocessTask).toHaveBeenCalledWith(db, 'velha', 'cli:teste', expect.any(Array));
    expect(out.join('\n')).toMatch(/Prévia nova na fila, reprocessando velha/);
  });
});

describe('gs tarefa tipos', () => {
  it('lista os tipos com os params', async () => {
    const { out, run } = setup();
    expect(await run('tipos')).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/^exemplo\.eco \(prévia\)/);
    expect(text).toMatch(/--param mensagem=<string>\s+Texto que a tarefa devolve/);
    expect(text).toMatch(/--param repeticoes=<integer> \(opcional\).*\[padrão 3\]/);
  });
});

it('age', () => {
  expect(age(new Date(NOW.getTime() - 5_000), NOW)).toBe('5 s');
  expect(age(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe('3 h');
});
