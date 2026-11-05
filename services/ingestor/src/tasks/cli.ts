/**
 * `gs tarefa`: a fila de tarefas pela linha de comando, de qualquer máquina com DATABASE_URL. As mesmas operações e
 * regras do painel (Ajustes → Sistema → Tarefas), de `@galaxie/db/queue-admin`. A aprovação da prévia não tem
 * comando: sai do clique de um admin no painel.
 *
 *   gs tarefa tipos [--json]
 *   gs tarefa enfileirar <tipo> [--param k=v]... [--prioridade N] [--previa] [--json]
 *   gs tarefa listar [--status pending,running,...] [--tipo T] [--limite N] [--json]
 *   gs tarefa ver <id> [--json]
 *   gs tarefa cancelar <id> [--json]         (só pendente)
 *   gs tarefa reprocessar <id> [--json]      (tarefa nova com os mesmos params, ligada à original)
 *
 * Runbook: docs/runbooks/tarefas.md.
 */
import { parseArgs } from 'node:util';
import type { Database } from '@galaxie/db';
import {
  awaitingApproval,
  cancelTask,
  getTask,
  listTasks,
  reprocessTask,
  requestTask,
  TASK_STATUSES,
  TaskError,
  taskState,
  type TaskDetail,
  type TaskRow,
} from '@galaxie/db/queue-admin';
import {
  coerceParams,
  ownParams,
  paramFields,
  paramsMeta,
  readLog,
  readPreview,
  readProgress,
  TASK_TYPES,
  taskType,
  type TaskRegistry,
} from '@galaxie/db/queue-types';

/** As operações da fila (injetáveis nos testes). */
export interface TarefaOps {
  requestTask: typeof requestTask;
  listTasks: typeof listTasks;
  getTask: typeof getTask;
  cancelTask: typeof cancelTask;
  reprocessTask: typeof reprocessTask;
}

export const DEFAULT_OPS: TarefaOps = { requestTask, listTasks, getTask, cancelTask, reprocessTask };

export interface TarefaIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Quem pede (registrado em requested_by). */
  by: string;
  now?: Date;
}

export const USAGE = `Uso: gs tarefa <comando> [opções]

  tipos                          tipos de tarefa e os parâmetros de cada um
  enfileirar <tipo>              põe na fila
      --param k=v                parâmetro do tipo (repita para vários)
      --prioridade N             maior sai primeiro (padrão 0)
      --previa                   só a prévia: conta e amostra o que mudaria, sem mudar nada
  listar                         tarefas mais recentes
      --status s1,s2             ${TASK_STATUSES.join(', ')}
      --tipo T  --limite N
  ver <id>                       detalhe, checkpoint e execuções
  cancelar <id>                  cancela a pendente
  reprocessar <id>               tarefa nova com os mesmos params, ligada à original

  --json                         saída em JSON (todos os comandos)

A execução de verdade de uma prévia sai do botão "Aprovar e executar" do painel (Ajustes → Sistema → Tarefas).`;

const STATE_TEXT: Record<ReturnType<typeof taskState>, string> = {
  pendente: 'pendente',
  retomada: 'retomada',
  rodando: 'rodando',
  concluida: 'concluída',
  falha: 'falha',
  cancelada: 'cancelada',
  outro: 'outro',
};

/** Idade em texto curto: 45 s, 12 min, 3 h, 2 d. */
export function age(from: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) =>
    r
      .map((cell, c) => cell.padEnd(widths[c]!))
      .join('  ')
      .trimEnd(),
  );
}

function stateOf(row: TaskRow): string {
  const meta = paramsMeta(row.params);
  const state = STATE_TEXT[taskState(row)];
  if (awaitingApproval(row)) return `${state}, aguarda aprovação`;
  return meta.previa ? `${state} (prévia)` : state;
}

function parseParamFlags(flags: readonly string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const flag of flags) {
    const eq = flag.indexOf('=');
    if (eq <= 0) throw new TaskError('params_invalidos', `--param espera k=v (veio "${flag}").`);
    raw[flag.slice(0, eq).trim()] = flag.slice(eq + 1);
  }
  return raw;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function renderDetail(t: TaskDetail, now: Date, io: TarefaIo) {
  const meta = paramsMeta(t.params);
  const progress = readProgress(t.checkpoint);
  const preview = readPreview(t.checkpoint);
  const lines = [
    `Tarefa ${t.id}`,
    `  tipo        ${t.type}${meta.previa ? ' (prévia)' : ''}`,
    `  estado      ${stateOf(t)}`,
    `  prioridade  ${t.priority}`,
    `  tentativas  ${t.attempts}/${t.maxAttempts}`,
    `  pedida      ${t.requestedAt.toISOString()} por ${t.requestedBy} (há ${age(t.requestedAt, now)})`,
  ];
  if (t.lockedBy) lines.push(`  worker      ${t.lockedBy} (concessão até ${t.lockedUntil?.toISOString()})`);
  if (t.finishedAt) lines.push(`  encerrada   ${t.finishedAt.toISOString()}`);
  if (meta.previaId) lines.push(`  aprovada    da prévia ${meta.previaId}`);
  if (meta.reprocessaDe) lines.push(`  reprocessa  ${meta.reprocessaDe}`);
  if (t.detail) lines.push(`  detalhe     ${t.detail}`);
  if (t.lastError && t.lastError !== t.detail) lines.push(`  último erro ${t.lastError}`);
  lines.push(`  params      ${JSON.stringify(ownParams(t.params))}`);
  if (progress)
    lines.push(
      `  progresso   ${progress.feitos}${progress.total !== undefined ? `/${progress.total}` : ''}${progress.lote ? ` · ${progress.lote}` : ''}`,
    );
  if (preview) {
    lines.push('  prévia');
    if (preview.resumo) lines.push(`    ${preview.resumo}`);
    for (const [k, v] of Object.entries(preview.contagens)) lines.push(`    ${k}: ${v}`);
    if (preview.amostra.length) lines.push(`    amostra: ${JSON.stringify(preview.amostra.slice(0, 10))}`);
    if (awaitingApproval(t) && !t.approvals.length)
      lines.push('    aguarda "Aprovar e executar" no painel (Ajustes → Sistema → Tarefas)');
  }
  for (const a of t.approvals)
    lines.push(`  execução    ${a.id} (${a.status}, aprovada por ${a.requestedBy})`);
  for (const r of t.reprocesses) lines.push(`  reprocessada ${r.id} (${r.status}, por ${r.requestedBy})`);
  const log = readLog(t.checkpoint);
  if (log.length) {
    lines.push('  log');
    for (const l of log) lines.push(`    ${l}`);
  }
  if (t.runs.length) {
    lines.push('  execuções');
    for (const r of t.runs)
      lines.push(
        `    ${r.startedAt.toISOString()}  ${r.status}${r.resumedFrom ? ' (retomada)' : ''}${r.error ? ` · ${r.error}` : ''}`,
      );
  }
  for (const l of lines) io.out(l);
}

function renderTypes(registry: TaskRegistry, io: TarefaIo) {
  for (const def of registry) {
    const flags = [def.previa ? 'prévia' : null, def.destrutiva ? 'destrutiva: só com prévia' : null]
      .filter(Boolean)
      .join(', ');
    io.out(`${def.type}${flags ? ` (${flags})` : ''}`);
    io.out(`  ${def.descricao}`);
    for (const f of paramFields(def))
      io.out(
        `  --param ${f.name}=<${f.options?.join('|') ?? f.kind}>${f.required ? '' : ' (opcional)'}${f.description ? `  ${f.description}` : ''}${f.default !== null ? ` [padrão ${JSON.stringify(f.default)}]` : ''}`,
      );
  }
}

/** Roda `gs tarefa ...`. Devolve o código de saída (0 ok, 1 recusa, 2 uso errado). */
export async function runTarefaCli(
  argv: readonly string[],
  db: Database,
  io: TarefaIo,
  ops: TarefaOps = DEFAULT_OPS,
  registry: TaskRegistry = TASK_TYPES,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        param: { type: 'string', multiple: true, default: [] },
        prioridade: { type: 'string' },
        previa: { type: 'boolean', default: false },
        status: { type: 'string' },
        tipo: { type: 'string' },
        limite: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    io.err(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, arg] = positionals;
  const now = io.now ?? new Date();
  const needId = () => {
    if (!arg) throw new UsageError(`${command} precisa do id da tarefa.`);
    return arg;
  };
  const int = (name: string, raw: string | undefined) => {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new UsageError(`--${name} espera um número inteiro (veio "${raw}").`);
    return n;
  };

  try {
    switch (values.help ? undefined : command) {
      case 'tipos': {
        if (values.json)
          io.out(
            json(
              registry.map((d) => ({
                type: d.type,
                descricao: d.descricao,
                previa: d.previa,
                destrutiva: d.destrutiva,
                params: paramFields(d),
              })),
            ),
          );
        else renderTypes(registry, io);
        return 0;
      }
      case 'enfileirar': {
        if (!arg) throw new UsageError('enfileirar precisa do tipo (gs tarefa tipos lista os conhecidos).');
        const def = taskType(arg, registry);
        const raw = parseParamFlags(values.param);
        const result = await ops.requestTask(
          db,
          {
            type: arg,
            params: def ? coerceParams(def, raw) : raw,
            priority: int('prioridade', values.prioridade) ?? 0,
            previa: values.previa,
            requestedBy: io.by,
          },
          registry,
        );
        if (values.json) io.out(json(result));
        else
          io.out(
            result.previa
              ? `Prévia ${result.id} na fila. Quando concluir, veja o plano com "gs tarefa ver ${result.id}" e aprove no painel.`
              : `Tarefa ${result.id} na fila.`,
          );
        return 0;
      }
      case 'listar': {
        const status = values.status
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = status?.filter((s) => !(TASK_STATUSES as readonly string[]).includes(s));
        if (unknown?.length)
          throw new UsageError(
            `--status desconhecido: ${unknown.join(', ')} (use ${TASK_STATUSES.join(', ')}).`,
          );
        const rows = await ops.listTasks(db, {
          ...(status?.length ? { status } : {}),
          ...(values.tipo ? { type: values.tipo } : {}),
          limit: int('limite', values.limite) ?? 50,
        });
        if (values.json) {
          io.out(
            json(rows.map((r) => ({ ...r, state: taskState(r), awaitingApproval: awaitingApproval(r) }))),
          );
          return 0;
        }
        if (!rows.length) {
          io.out('Nenhuma tarefa.');
          return 0;
        }
        const lines = table([
          ['ID', 'TIPO', 'ESTADO', 'PRIOR.', 'TENT.', 'IDADE', 'WORKER', 'PROGRESSO'],
          ...rows.map((r) => {
            const p = readProgress(r.checkpoint);
            return [
              r.id,
              r.type,
              stateOf(r),
              String(r.priority),
              `${r.attempts}/${r.maxAttempts}`,
              age(r.requestedAt, now),
              r.lockedBy ?? '-',
              p ? `${p.feitos}${p.total !== undefined ? `/${p.total}` : ''}` : '-',
            ];
          }),
        ]);
        for (const l of lines) io.out(l);
        return 0;
      }
      case 'ver': {
        const detail = await ops.getTask(db, needId());
        if (values.json) io.out(json({ ...detail, state: taskState(detail) }));
        else renderDetail(detail, now, io);
        return 0;
      }
      case 'cancelar': {
        const id = needId();
        await ops.cancelTask(db, id, io.by);
        io.out(values.json ? json({ id, status: 'canceled' }) : `Tarefa ${id} cancelada.`);
        return 0;
      }
      case 'reprocessar': {
        const id = needId();
        const result = await ops.reprocessTask(db, id, io.by, registry);
        if (values.json) io.out(json({ ...result, reprocessaDe: id }));
        else
          io.out(
            result.previa
              ? `Prévia ${result.id} na fila, reprocessando ${id}. A execução de verdade sai da aprovação no painel.`
              : `Tarefa ${result.id} na fila, reprocessando ${id}.`,
          );
        return 0;
      }
      default:
        if (command && !values.help) io.err(`Comando desconhecido: ${command}.`);
        io.err(USAGE);
        return command && !values.help ? 2 : 0;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(err.message);
      return 2;
    }
    if (err instanceof TaskError) {
      if (values.json) io.out(json({ error: err.code, message: err.message, details: err.details }));
      else io.err(err.message);
      return 1;
    }
    throw err;
  }
}

class UsageError extends Error {}
