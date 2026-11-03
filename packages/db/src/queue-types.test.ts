import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EXEMPLO_ECO,
  TASK_TYPES,
  appendLog,
  checkRunnable,
  coerceParams,
  defineTaskType,
  ownParams,
  paramFields,
  paramsMeta,
  parseParams,
  readLog,
  readPreview,
  readProgress,
  taskType,
  TASK_LOG_MAX,
  type TaskTypeDef,
} from './queue-types.js';

const eco = EXEMPLO_ECO as unknown as TaskTypeDef;
const DESTRUTIVA = defineTaskType({
  type: 'teste.apaga',
  descricao: 'apaga',
  params: z.object({ pais: z.enum(['BR', 'AR']), limite: z.number().int().optional(), dryRun: z.boolean() }),
  previa: true,
  destrutiva: true,
}) as unknown as TaskTypeDef;

describe('registro de tipos', () => {
  it('tem o exemplo.eco, com prévia e sem ser destrutivo', () => {
    expect(taskType('exemplo.eco')).toBe(eco);
    expect(taskType('nao.existe')).toBeUndefined();
    expect(eco).toMatchObject({ previa: true, destrutiva: false });
  });

  it('todo tipo destrutivo roda em prévia, e nenhum declara chave reservada', () => {
    for (const def of TASK_TYPES) {
      if (def.destrutiva) expect(def.previa).toBe(true);
      expect(Object.keys(def.params.shape)).not.toContain('previa');
    }
  });

  it('recusa destrutiva sem prévia e chave reservada', () => {
    expect(() =>
      defineTaskType({ type: 'x', descricao: 'x', params: z.object({}), previa: false, destrutiva: true }),
    ).toThrow(/destrutiva precisa rodar em prévia/);
    expect(() =>
      defineTaskType({
        type: 'x',
        descricao: 'x',
        params: z.object({ previaId: z.string() }),
        previa: true,
        destrutiva: false,
      }),
    ).toThrow(/previaId é chave reservada/);
  });
});

describe('params', () => {
  it('lê os campos do schema, com obrigatório, padrão, descrição e opções', () => {
    expect(paramFields(eco)).toEqual([
      {
        name: 'mensagem',
        kind: 'string',
        required: true,
        description: 'Texto que a tarefa devolve',
        options: null,
        default: null,
      },
      {
        name: 'repeticoes',
        kind: 'integer',
        required: false,
        description: 'Quantos lotes simular',
        options: null,
        default: 3,
      },
    ]);
    expect(paramFields(DESTRUTIVA).map((f) => [f.name, f.kind, f.required, f.options])).toEqual([
      ['pais', 'enum', true, ['BR', 'AR']],
      ['limite', 'integer', false, null],
      ['dryRun', 'boolean', true, null],
    ]);
  });

  it('converte o texto pelo tipo do campo e larga o vazio', () => {
    expect(coerceParams(eco, { mensagem: ' oi ', repeticoes: '5' })).toEqual({
      mensagem: ' oi ',
      repeticoes: 5,
    });
    expect(coerceParams(eco, { mensagem: 'oi', repeticoes: '' })).toEqual({ mensagem: 'oi' });
    expect(coerceParams(DESTRUTIVA, { pais: 'BR', dryRun: 'sim', limite: 'dez' })).toEqual({
      pais: 'BR',
      dryRun: true,
      limite: 'dez',
    });
  });

  it('valida pelo schema, aplica o padrão e recusa chave desconhecida', () => {
    expect(parseParams(eco, { mensagem: ' oi ' })).toEqual({
      ok: true,
      value: { mensagem: 'oi', repeticoes: 3 },
    });
    const bad = parseParams(eco, { mensagem: '', repeticoes: 99, extra: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues).toContain('extra: parâmetro desconhecido');
      expect(bad.issues.some((i) => i.startsWith('mensagem:'))).toBe(true);
      expect(bad.issues.some((i) => i.startsWith('repeticoes:'))).toBe(true);
    }
  });

  it('separa os params do tipo dos que o sistema preenche', () => {
    const params = { mensagem: 'oi', previa: true, previaId: 'p', reprocessaDe: 'r' };
    expect(paramsMeta(params)).toEqual({ previa: true, previaId: 'p', reprocessaDe: 'r' });
    expect(ownParams(params)).toEqual({ mensagem: 'oi' });
    expect(paramsMeta(null)).toEqual({ previa: false, previaId: null, reprocessaDe: null });
  });
});

describe('checkpoint', () => {
  it('lê prévia, progresso e log, e ignora o que não confere', () => {
    const cp = {
      previa: { resumo: 'r', contagens: { times: 3 }, amostra: ['a'] },
      progresso: { feitos: 2, total: 5, lote: 'Brasil' },
      log: ['a', 1, 'b'],
    };
    expect(readPreview(cp)).toEqual({ resumo: 'r', contagens: { times: 3 }, amostra: ['a'] });
    expect(readPreview({ previa: { contagens: { times: 'x' } } })).toBeNull();
    expect(readPreview({})).toBeNull();
    expect(readProgress(cp)).toEqual({ feitos: 2, total: 5, lote: 'Brasil' });
    expect(readProgress(null)).toBeNull();
    expect(readLog(cp)).toEqual(['a', 'b']);
  });

  it('o log guarda só as últimas linhas', () => {
    let cp: unknown = null;
    for (let i = 0; i < TASK_LOG_MAX + 5; i++) cp = { log: appendLog(cp, `linha ${i}`) };
    const log = readLog(cp);
    expect(log).toHaveLength(TASK_LOG_MAX);
    expect(log.at(-1)).toBe(`linha ${TASK_LOG_MAX + 4}`);
  });
});

describe('checkRunnable', () => {
  const registry = [eco, DESTRUTIVA];
  it('recusa tipo desconhecido, destrutiva sem prévia nem aprovação e params inválidos', () => {
    expect(checkRunnable({ type: 'nao.existe', params: {} }, registry)).toMatch(/desconhecido/);
    expect(checkRunnable({ type: 'teste.apaga', params: { pais: 'BR', dryRun: false } }, registry)).toMatch(
      /destrutiva/,
    );
    expect(checkRunnable({ type: 'exemplo.eco', params: { mensagem: '' } }, registry)).toMatch(
      /params inválidos/,
    );
  });

  it('aceita a prévia e a execução aprovada da destrutiva', () => {
    const params = { pais: 'BR', dryRun: false };
    expect(checkRunnable({ type: 'teste.apaga', params: { ...params, previa: true } }, registry)).toBeNull();
    expect(checkRunnable({ type: 'teste.apaga', params: { ...params, previaId: 'x' } }, registry)).toBeNull();
    expect(checkRunnable({ type: 'exemplo.eco', params: { mensagem: 'oi', repeticoes: 1 } })).toBeNull();
  });
});
