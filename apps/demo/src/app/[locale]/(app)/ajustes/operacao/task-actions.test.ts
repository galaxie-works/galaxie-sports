/**
 * Ações da seção Tarefas: só admin, entrada conferida com zod, params convertidos pelo schema do tipo, quem pediu
 * vem da sessão e a recusa da fila chega traduzida.
 */
import { TaskError } from '@galaxie/db/queue-admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const requestTask = vi.fn();
const cancelTask = vi.fn();
const reprocessTask = vi.fn();
const approvePreview = vi.fn();
const readTask = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/ops/tasks', () => ({ queueDb: () => ({}), readTask: (id: string) => readTask(id) }));
vi.mock('@galaxie/db/queue-admin', async (orig) => ({
  ...(await orig<typeof import('@galaxie/db/queue-admin')>()),
  requestTask: (...a: unknown[]) => requestTask(...a),
  cancelTask: (...a: unknown[]) => cancelTask(...a),
  reprocessTask: (...a: unknown[]) => reprocessTask(...a),
  approvePreview: (...a: unknown[]) => approvePreview(...a),
}));

const { approveTaskAction, cancelTaskAction, enqueueTask, loadTask, reprocessTaskAction } =
  await import('./task-actions');

const ADMIN = { id: 'u-admin', email: 'teste.admin@galaxie.test' };
const ID = '019a0000-0000-7000-8000-000000000001';
const redirected = () => {
  throw new Error('NEXT_REDIRECT');
};
const mocks = [
  requireAdmin,
  requestTask,
  cancelTask,
  reprocessTask,
  approvePreview,
  readTask,
  revalidatePath,
];

beforeEach(() => {
  mocks.forEach((m) => m.mockReset());
  requireAdmin.mockResolvedValue(ADMIN);
});

describe('só admin', () => {
  it('nenhuma ação chega na fila sem a sessão de admin', async () => {
    requireAdmin.mockImplementation(redirected);
    await expect(enqueueTask({ type: 'exemplo.eco', params: { mensagem: 'oi' } })).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    await expect(approveTaskAction(ID)).rejects.toThrow('NEXT_REDIRECT');
    await expect(cancelTaskAction(ID)).rejects.toThrow('NEXT_REDIRECT');
    await expect(reprocessTaskAction(ID)).rejects.toThrow('NEXT_REDIRECT');
    await expect(loadTask(ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(requestTask).not.toHaveBeenCalled();
    expect(approvePreview).not.toHaveBeenCalled();
    expect(cancelTask).not.toHaveBeenCalled();
    expect(reprocessTask).not.toHaveBeenCalled();
    expect(readTask).not.toHaveBeenCalled();
  });
});

describe('enqueueTask', () => {
  it('converte os params pelo schema do tipo e grava quem pediu', async () => {
    requestTask.mockResolvedValue({ id: ID, previa: true });
    const res = await enqueueTask({
      type: 'exemplo.eco',
      params: { mensagem: 'oi', repeticoes: '4' },
      priority: 7,
      previa: true,
    });
    expect(res).toEqual({ ok: true, id: ID, previa: true });
    expect(requestTask).toHaveBeenCalledWith(
      {},
      {
        type: 'exemplo.eco',
        params: { mensagem: 'oi', repeticoes: 4 },
        priority: 7,
        previa: true,
        requestedBy: ADMIN.email,
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/ajustes/sistema');
  });

  it('entrada fora do formato não chega na fila', async () => {
    const res = await enqueueTask({ type: '', params: {} } as never);
    expect(res).toEqual({ ok: false, error: 'Pedido inválido.' });
    const big = await enqueueTask({ type: 'exemplo.eco', priority: 1.5 } as never);
    expect(big.ok).toBe(false);
    expect(requestTask).not.toHaveBeenCalled();
  });

  it('a recusa da fila volta traduzida, com os problemas por campo', async () => {
    requestTask.mockRejectedValueOnce(
      new TaskError('params_invalidos', 'x', ['mensagem: Too small: expected string to have >=1 characters']),
    );
    expect(await enqueueTask({ type: 'exemplo.eco', params: {} })).toEqual({
      ok: false,
      error: 'Parâmetros inválidos.',
      issues: ['mensagem: Too small: expected string to have >=1 characters'],
    });
    requestTask.mockRejectedValueOnce(new TaskError('previa_obrigatoria', 'x'));
    expect(await enqueueTask({ type: 'teste.apaga', params: {} })).toEqual({
      ok: false,
      error: 'Este tipo apaga, troca ou religa dados: enfileire em prévia e aprove depois.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('aprovar, cancelar, reprocessar e ver', () => {
  it('aprovar enfileira a real em nome de quem clicou', async () => {
    approvePreview.mockResolvedValue({ id: 'real' });
    expect(await approveTaskAction(ID)).toEqual({ ok: true, id: 'real', previa: false });
    expect(approvePreview).toHaveBeenCalledWith({}, ID, ADMIN.email);
    approvePreview.mockRejectedValueOnce(new TaskError('ja_aprovada', 'x', ['real']));
    expect(await approveTaskAction(ID)).toEqual({ ok: false, error: 'Esta prévia já foi aprovada.' });
  });

  it('id que não é uuid nem chega na fila', async () => {
    for (const action of [approveTaskAction, cancelTaskAction, reprocessTaskAction, loadTask])
      expect(await action('1; drop table')).toEqual({ ok: false, error: 'Tarefa não encontrada.' });
    expect(approvePreview).not.toHaveBeenCalled();
    expect(cancelTask).not.toHaveBeenCalled();
    expect(reprocessTask).not.toHaveBeenCalled();
    expect(readTask).not.toHaveBeenCalled();
  });

  it('cancelar e reprocessar passam quem pediu e revalidam a página', async () => {
    cancelTask.mockResolvedValue(undefined);
    reprocessTask.mockResolvedValue({ id: 'nova', previa: true });
    expect(await cancelTaskAction(ID)).toEqual({ ok: true, id: ID });
    expect(cancelTask).toHaveBeenCalledWith({}, ID, ADMIN.email);
    expect(await reprocessTaskAction(ID)).toEqual({ ok: true, id: 'nova', previa: true });
    expect(reprocessTask).toHaveBeenCalledWith({}, ID, ADMIN.email);
    cancelTask.mockRejectedValueOnce(new TaskError('nao_pendente', 'x'));
    expect(await cancelTaskAction(ID)).toEqual({
      ok: false,
      error: 'Só a tarefa pendente pode ser cancelada.',
    });
  });

  it('ver devolve o detalhe', async () => {
    readTask.mockResolvedValue({ id: ID });
    expect(await loadTask(ID)).toEqual({ ok: true, task: { id: ID } });
    readTask.mockRejectedValueOnce(new TaskError('nao_encontrada', 'x'));
    expect(await loadTask(ID)).toEqual({ ok: false, error: 'Tarefa não encontrada.' });
  });
});
