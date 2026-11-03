// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { OpsTasks, TaskDetailView, TaskListItem } from '@/lib/ops/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/[locale]/(app)/ajustes/operacao/task-actions', () => ({
  approveTaskAction: vi.fn(),
  cancelTaskAction: vi.fn(),
  enqueueTask: vi.fn(),
  loadTask: vi.fn(async () => ({ ok: false, error: 'x' })),
  reprocessTaskAction: vi.fn(),
}));
vi.mock('@/components/reui/code-block/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre data-testid="code">{code}</pre>,
}));

const { TasksTab, TaskDetailBody, matchesFilter } = await import('./tasks-tab');

afterEach(cleanup);

const NOW = '2026-11-02T12:00:00.000Z';

function item(over: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    type: 'exemplo.eco',
    status: 'pending',
    state: 'pendente',
    previa: false,
    awaitingApproval: false,
    previaId: null,
    reprocessaDe: null,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    lockedBy: null,
    lockedUntil: null,
    requestedBy: 'teste.admin@galaxie.test',
    requestedAt: '2026-11-02T11:50:00.000Z',
    finishedAt: null,
    progress: null,
    detail: null,
    lastError: null,
    ...over,
  };
}

function detail(over: Partial<TaskDetailView> = {}): TaskDetailView {
  return {
    ...item(),
    destrutiva: false,
    params: { mensagem: 'oi', repeticoes: 3 },
    checkpoint: null,
    preview: null,
    log: [],
    runs: [],
    approvals: [],
    reprocesses: [],
    ...over,
  };
}

const TYPES: OpsTasks['types'] = [
  {
    type: 'exemplo.eco',
    descricao: 'Exemplo',
    previa: true,
    destrutiva: false,
    fields: [
      { name: 'mensagem', kind: 'string', required: true, description: null, options: null, default: null },
    ],
  },
];

const wrap = (ui: React.ReactNode) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      {ui}
    </I18nProvider>,
  );

describe('lista de tarefas', () => {
  const tasks: OpsTasks = {
    types: TYPES,
    items: [
      item({
        id: 'a',
        status: 'running',
        state: 'rodando',
        attempts: 1,
        lockedBy: 'worker-1',
        progress: { feitos: 2, total: 4, lote: null },
      }),
      item({ id: 'b', status: 'done', state: 'concluida', previa: true, awaitingApproval: true }),
      item({ id: 'c', status: 'pending', state: 'retomada' }),
      item({ id: 'd', status: 'error', state: 'falha', lastError: 'boom' }),
    ],
  };

  it('mostra tipo, estado, tentativas, worker e progresso, e filtra por estado', () => {
    const { container } = wrap(<TasksTab tasks={tasks} timeZone="America/Sao_Paulo" now={NOW} />);
    const rows = () =>
      [...container.querySelectorAll('tr[data-task]')].map((r) => r.getAttribute('data-task'));
    expect(rows()).toEqual(['a', 'b', 'c', 'd']);
    const running = container.querySelector('tr[data-task="a"]')!;
    expect(running.textContent).toContain('Rodando');
    expect(running.textContent).toContain('1/3');
    expect(running.textContent).toContain('worker-1');
    expect(running.textContent).toContain('2 de 4');
    const preview = container.querySelector('tr[data-task="b"]')!;
    expect(preview.textContent).toContain('Prévia');
    expect(preview.textContent).toContain('Aguarda aprovação');

    fireEvent.click(screen.getByRole('button', { name: /Aguardando aprovação/ }));
    expect(rows()).toEqual(['b']);
    fireEvent.click(screen.getByRole('button', { name: /Retomadas/ }));
    expect(rows()).toEqual(['c']);
    fireEvent.click(screen.getByRole('button', { name: /Canceladas/ }));
    expect(rows()).toEqual([]);
    expect(container.textContent).toContain('Nenhuma tarefa neste estado.');
  });

  it('sem a fila no banco, avisa em vez de quebrar', () => {
    const { container } = wrap(<TasksTab tasks={null} timeZone="UTC" now={NOW} />);
    expect(container.textContent).toContain('migration pendente');
  });

  it('matchesFilter', () => {
    expect(matchesFilter(item({ awaitingApproval: true, state: 'concluida' }), 'awaiting')).toBe(true);
    expect(matchesFilter(item({ state: 'falha' }), 'concluida')).toBe(false);
    expect(matchesFilter(item(), 'all')).toBe(true);
  });
});

describe('detalhe da tarefa', () => {
  const body = (task: TaskDetailView) =>
    wrap(<TaskDetailBody task={task} timeZone="UTC" onChanged={vi.fn()} onOpen={vi.fn()} />);
  const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent?.trim());

  it('prévia concluída: mostra o plano e o "Aprovar e executar"', () => {
    const { container } = body(
      detail({
        status: 'done',
        state: 'concluida',
        previa: true,
        awaitingApproval: true,
        preview: { resumo: 'Devolveria "oi" em 3 lote(s).', contagens: { lotes: 3 }, amostra: ['oi'] },
        checkpoint: { previa: { contagens: { lotes: 3 } } },
      }),
    );
    expect(container.textContent).toContain('Devolveria "oi" em 3 lote(s).');
    expect(container.textContent).toContain('lotes');
    expect(buttons()).toContain('Aprovar e executar');
    expect(buttons()).toContain('Reprocessar');
    expect(buttons()).not.toContain('Cancelar tarefa');
  });

  it('prévia já aprovada: sem o botão de aprovar, com o link da execução', () => {
    const { container } = body(
      detail({
        status: 'done',
        state: 'concluida',
        previa: true,
        awaitingApproval: false,
        preview: { resumo: null, contagens: {}, amostra: [] },
        approvals: [{ id: 'real-1', status: 'running', requestedBy: 'bia@galaxie.test', requestedAt: NOW }],
      }),
    );
    expect(buttons()).not.toContain('Aprovar e executar');
    expect(container.textContent).toContain('Execução aprovada');
    expect(buttons()).toContain('real-1');
  });

  it('pendente: só cancelar; rodando: nenhum botão de ação', () => {
    body(detail());
    expect(buttons()).toEqual(['Cancelar tarefa']);
    cleanup();
    body(detail({ status: 'running', state: 'rodando', lockedBy: 'w1', lockedUntil: NOW }));
    expect(buttons()).toEqual([]);
  });

  it('mostra params, progresso, log, execuções e checkpoint', () => {
    const { container } = body(
      detail({
        status: 'done',
        state: 'concluida',
        progress: { feitos: 3, total: 3, lote: 'lote 3' },
        log: ['lote 1/3: oi', 'lote 3/3: oi'],
        checkpoint: { progresso: { feitos: 3 } },
        runs: [
          {
            id: 'r1',
            status: 'interrupted',
            startedAt: NOW,
            finishedAt: NOW,
            error: null,
            resumed: false,
            worker: 'w1',
          },
          {
            id: 'r2',
            status: 'ok',
            startedAt: NOW,
            finishedAt: NOW,
            error: null,
            resumed: true,
            worker: 'w2',
          },
        ],
      }),
    );
    const text = container.textContent!;
    expect(text).toContain('mensagem');
    expect(text).toContain('3 de 3');
    expect(text).toContain('Lote: lote 3');
    expect(text).toContain('lote 3/3: oi');
    expect(text).toContain('retomada');
    expect(screen.getByTestId('code').textContent).toContain('"feitos": 3');
  });
});
