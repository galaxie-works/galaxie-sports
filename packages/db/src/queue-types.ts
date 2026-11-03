/**
 * Registro dos tipos de tarefa da fila (`@galaxie/db/queue`): o que cada tipo faz, os `params` que aceita (schema
 * zod) e se roda em prévia ou exige prévia. A CLI (`gs tarefa`) e o painel (Ajustes → Sistema → Tarefas) validam
 * por aqui antes de enfileirar; o worker confere de novo antes de executar (`checkRunnable`).
 *
 * Só declaração: quem executa cada tipo mora no worker. Para registrar um tipo novo, acrescente uma entrada em
 * `TASK_TYPES` com `defineTaskType` (e o executor no worker). Contrato: packages/db/README.md, "Tipos de tarefa".
 *
 * A regra do produto: tarefa que apaga, troca ou religa dados (`destrutiva`) roda primeiro em prévia; a execução de
 * verdade só sai de uma aprovação de admin, que enfileira a real com `previaId` apontando para a prévia.
 */
import { z } from 'zod';

/** Chaves dos `params` que o sistema preenche: nenhum tipo pode declarar, e quem enfileira não pode mandar. */
export const RESERVED_PARAMS = ['previa', 'previaId', 'reprocessaDe'] as const;
export type ReservedParam = (typeof RESERVED_PARAMS)[number];

export interface TaskTypeDef<S extends z.ZodRawShape = z.ZodRawShape> {
  type: string;
  /** Uma frase, em linguagem de negócio: aparece na CLI e no painel. */
  descricao: string;
  /** Schema dos `params` (sem as chaves reservadas). Chave desconhecida é recusada. */
  params: z.ZodObject<S>;
  /** O executor sabe rodar em prévia: conta e amostra o que mudaria, sem mudar nada. */
  previa: boolean;
  /** Apaga, troca ou religa dados: não pode ser enfileirada direto, só em prévia e depois pela aprovação. */
  destrutiva: boolean;
  /** Tentativas por tarefa (padrão da fila: 3). Tarefa longa, que cai sem culpa, pede mais. */
  maxAttempts?: number;
}

/** Declara um tipo; recusa a combinação que quebraria a regra (destrutiva sem prévia) e a chave reservada. */
export function defineTaskType<S extends z.ZodRawShape>(def: TaskTypeDef<S>): TaskTypeDef<S> {
  if (def.destrutiva && !def.previa)
    throw new Error(`Tipo de tarefa ${def.type}: destrutiva precisa rodar em prévia (previa: true).`);
  const reserved = Object.keys(def.params.shape).filter((k) =>
    (RESERVED_PARAMS as readonly string[]).includes(k),
  );
  if (reserved.length)
    throw new Error(`Tipo de tarefa ${def.type}: ${reserved.join(', ')} é chave reservada dos params.`);
  return def;
}

/**
 * Exemplo e teste de ponta a ponta da fila: devolve a mensagem em `repeticoes` lotes, gravando o checkpoint a cada
 * lote. Não toca em dado nenhum; a prévia só conta os lotes.
 */
export const EXEMPLO_ECO = defineTaskType({
  type: 'exemplo.eco',
  descricao: 'Exemplo: devolve a mensagem em lotes e grava o checkpoint a cada um. Não muda dado nenhum.',
  params: z.object({
    mensagem: z.string().trim().min(1).max(200).describe('Texto que a tarefa devolve'),
    repeticoes: z.number().int().min(1).max(20).default(3).describe('Quantos lotes simular'),
    pausaMs: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .default(0)
      .describe('Espera em cada lote (ms), para exercitar a drenagem do worker'),
  }),
  previa: true,
  destrutiva: false,
  maxAttempts: 3,
});

// ── tipos reais (#543): executores em services/ingestor/src/tasks ─────────────────────────────────

/** Endereço `s3://<bucket>/<chave>` (sem `..`). */
const s3Uri = (ext: RegExp, what: string) =>
  z
    .string()
    .trim()
    .regex(
      /^s3:\/\/[a-z0-9][a-z0-9.-]{1,62}\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/i,
      `use s3://<bucket>/<chave> (${what})`,
    )
    .regex(ext, `use s3://<bucket>/<chave> (${what})`);

/**
 * Acervo de escudos: o pacote vem do S3 (`tasks/<id>/` do bucket privado das tarefas, S3_TASKS_BUCKET), a importação
 * anda em lotes por país (até `lote` escudos cada) e o checkpoint é o último lote. Religa escudos, então é destrutiva:
 * a prévia (como o `--plan` de `assets:acervo`) grava o plano e o relatório de cobertura em
 * `tasks/<id da prévia>/cobertura.md` do bucket das tarefas e em `checkpoint.previa`; a execução só sai da aprovação.
 */
export const ACERVO_IMPORTAR = defineTaskType({
  type: 'acervo.importar',
  descricao:
    'Importa o acervo de escudos de um pacote no S3: liga os escudos do manifesto aos times e competições e desliga os que saíram. Em lotes por país.',
  params: z.object({
    pacote: s3Uri(/\.(tgz|tar\.gz)$/i, '.tgz').describe(
      'Pacote no S3: s3://galaxie-sports-tasks/tasks/<id>/<arquivo>.tgz (bucket privado das tarefas)',
    ),
    acervo: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'id do acervo: letras minúsculas, números e hífen')
      .describe('Id do acervo (o mesmo do acervo.yaml do pacote)'),
    manifesto: s3Uri(/\.ya?ml$/i, '.yaml')
      .optional()
      .describe('Manifesto no S3 (padrão: o versionado em config/assets/acervo/<acervo>.yaml)'),
    lote: z.number().int().min(10).max(500).default(100).describe('Escudos por lote'),
  }),
  previa: true,
  destrutiva: true,
  maxAttempts: 10,
});

/**
 * Espelho de assets (o `mirror-assets`): lotes de `lote` assets com o cursor por tipo de asset em ops.sync_cursor;
 * retoma de onde parou. Não é destrutiva: é a manutenção diária do scheduler (com QUEUE_MODE=enqueue, o cron só
 * enfileira esta tarefa).
 */
export const ASSETS_ESPELHAR = defineTaskType({
  type: 'assets.espelhar',
  descricao:
    'Espelha no S3 os logos, bandeiras e fotos que faltam (CDN de mídia; não gasta cota da API), retomando do cursor por tipo de asset.',
  params: z.object({
    limite: z.number().int().min(1).max(200_000).default(2000).describe('Máximo de assets nesta tarefa'),
    lote: z
      .number()
      .int()
      .min(10)
      .max(5000)
      .default(200)
      .describe('Assets por lote (checkpoint a cada lote)'),
    descobrirRaw: z.boolean().default(true).describe('Antes, registra as URLs de mídia do raw novo'),
    retentarAusentes: z.boolean().default(false).describe('Tenta de novo os ausentes (404, bloqueados)'),
    caminho: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'pasta da CDN: football, volley…')
      .optional()
      .describe('Só a mídia de um esporte (pasta na CDN)'),
    concorrencia: z.number().int().min(1).max(8).default(3).describe('Downloads simultâneos'),
  }),
  previa: true,
  destrutiva: false,
  maxAttempts: 5,
});

/** Etapas da carga histórica do futebol (#417), na ordem em que rodam. */
export const CARGA_ETAPAS = ['temporadas', 'detalhes', 'pessoas', 'perfis'] as const;
export type CargaEtapa = (typeof CARGA_ETAPAS)[number];

/**
 * Carga histórica do futebol (#417): temporadas e detalhes em lotes por liga, depois pessoas e perfis; checkpoint por
 * lote. Quando a cota do dia acaba, a tarefa volta à fila para o próximo dia de cota (não falha).
 */
export const CARGA_HISTORICA = defineTaskType({
  type: 'carga.historica',
  descricao:
    'Carga histórica do futebol: temporadas, detalhes, pessoas e perfis, em lotes por liga. Gasta cota; quando a cota do dia acaba, volta à fila para o dia seguinte.',
  params: z.object({
    etapas: z
      .array(z.enum(CARGA_ETAPAS))
      .min(1)
      .default([...CARGA_ETAPAS])
      .describe('Etapas, na ordem: temporadas, detalhes, pessoas, perfis'),
    tierMax: z.number().int().min(1).max(3).default(2).describe('Maior tier do catálogo incluído'),
    ligas: z.array(z.number().int().positive()).optional().describe('Só estas ligas (ids da api-sports)'),
    semLive: z.boolean().default(false).describe('Planeja o dia sem ao vivo, para liberar a cota à carga'),
    maxChamadasPorLote: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Teto de chamadas que gastam cota em cada lote'),
  }),
  previa: true,
  destrutiva: false,
  maxAttempts: 5,
});

/**
 * Normalização raw → core do futebol, completa (o `normalize:football --tudo`), em lotes por endpoint do raw. Sem
 * chamada ao fornecedor; reprocessar o mesmo endpoint dá o mesmo resultado.
 */
export const BACKFILL_NORMALIZAR = defineTaskType({
  type: 'backfill.normalizar',
  descricao:
    'Reprocessa o raw do futebol para o core (normalização completa), um endpoint por lote. Não chama o fornecedor.',
  params: z.object({
    endpoints: z
      .array(z.string().regex(/^\/[a-z/]+$/, 'endpoint como /fixtures'))
      .optional()
      .describe('Só estes endpoints (padrão: todos os do raw do futebol)'),
  }),
  previa: true,
  destrutiva: false,
  maxAttempts: 5,
});

/**
 * Recálculo local das tabelas (o `standings:recompute`), em lotes de temporadas. Sem chamada ao fornecedor.
 */
export const BACKFILL_TABELAS = defineTaskType({
  type: 'backfill.tabelas',
  descricao:
    'Recalcula as tabelas a partir dos resultados do core, em lotes de temporadas. Não chama o fornecedor.',
  params: z.object({
    dias: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .default(4)
      .describe('Temporadas com resultado novo nestes dias (ignorado com temporadas)'),
    temporadas: z.array(z.string().uuid()).optional().describe('Só estas temporadas (ids do core)'),
    lote: z.number().int().min(1).max(200).default(20).describe('Temporadas por lote'),
  }),
  previa: true,
  destrutiva: false,
  maxAttempts: 5,
});

export type TaskRegistry = readonly TaskTypeDef[];

/** Todos os tipos conhecidos. */
export const TASK_TYPES: TaskRegistry = [
  EXEMPLO_ECO,
  ACERVO_IMPORTAR,
  ASSETS_ESPELHAR,
  CARGA_HISTORICA,
  BACKFILL_NORMALIZAR,
  BACKFILL_TABELAS,
] as unknown as TaskRegistry;

export function taskType(type: string, registry: TaskRegistry = TASK_TYPES): TaskTypeDef | undefined {
  return registry.find((d) => d.type === type);
}

// ── prévia e progresso no checkpoint ────────────────────────────────────────────────────────────

/**
 * O que a prévia grava em `checkpoint.previa`: contagens do que mudaria e uma amostra, como o `--plan` do acervo.
 * O painel mostra isto antes do botão "Aprovar e executar".
 */
export const previewResultSchema = z.object({
  resumo: z.string().optional(),
  contagens: z.record(z.string(), z.number()).default({}),
  amostra: z.array(z.unknown()).default([]),
});
export type PreviewResult = z.infer<typeof previewResultSchema>;

/** Progresso por lote em `checkpoint.progresso` (opcional; o painel mostra a barra quando há `total`). */
export const progressSchema = z.object({
  feitos: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
  /** Lote corrente, em texto livre (ex.: "Brasil", "temporada 2019"). */
  lote: z.string().optional(),
});
export type TaskProgress = z.infer<typeof progressSchema>;

/** Log resumido em `checkpoint.log`: só as últimas linhas (o worker corta; o painel e a CLI mostram estas). */
export const TASK_LOG_MAX = 20;

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Resultado da prévia gravado no checkpoint; null se não há (ou não confere com o formato). */
export function readPreview(checkpoint: unknown): PreviewResult | null {
  const raw = record(checkpoint)?.previa;
  if (raw === undefined) return null;
  const parsed = previewResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readProgress(checkpoint: unknown): TaskProgress | null {
  const parsed = progressSchema.safeParse(record(checkpoint)?.progresso);
  return parsed.success ? parsed.data : null;
}

export function readLog(checkpoint: unknown): string[] {
  const log = record(checkpoint)?.log;
  return Array.isArray(log) ? log.filter((l): l is string => typeof l === 'string').slice(-TASK_LOG_MAX) : [];
}

/** Acrescenta uma linha ao log, mantendo só as últimas TASK_LOG_MAX. */
export function appendLog(checkpoint: unknown, line: string): string[] {
  return [...readLog(checkpoint), line].slice(-TASK_LOG_MAX);
}

// ── params ──────────────────────────────────────────────────────────────────────────────────────

/** O que o sistema preencheu nos params de uma tarefa. */
export interface TaskParamsMeta {
  /** A tarefa é a prévia: conta e amostra, sem mudar nada. */
  previa: boolean;
  /** A tarefa é a execução aprovada desta prévia. */
  previaId: string | null;
  /** A tarefa reprocessa esta outra. */
  reprocessaDe: string | null;
}

export function paramsMeta(params: unknown): TaskParamsMeta {
  const p = record(params) ?? {};
  return {
    previa: p.previa === true,
    previaId: typeof p.previaId === 'string' ? p.previaId : null,
    reprocessaDe: typeof p.reprocessaDe === 'string' ? p.reprocessaDe : null,
  };
}

/** Os params sem as chaves reservadas: o que o tipo declarou. */
export function ownParams(params: unknown): Record<string, unknown> {
  const p = { ...(record(params) ?? {}) };
  for (const k of RESERVED_PARAMS) delete p[k];
  return p;
}

/** Campo do formulário (painel) e da ajuda (CLI), lido do schema. */
export interface TaskParamField {
  name: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'json';
  required: boolean;
  description: string | null;
  options: string[] | null;
  default: unknown;
}

interface JsonSchemaProp {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
}

/** Campos dos params do tipo, na ordem do schema. Serializável: o painel manda para o formulário. */
export function paramFields(def: TaskTypeDef): TaskParamField[] {
  const schema = z.toJSONSchema(def.params, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, JsonSchemaProp>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type;
    const kind: TaskParamField['kind'] = prop.enum
      ? 'enum'
      : type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
        ? type
        : 'json';
    return {
      name,
      kind,
      required: required.has(name) && prop.default === undefined,
      description: prop.description ?? null,
      options: prop.enum ? prop.enum.map(String) : null,
      default: prop.default ?? null,
    };
  });
}

const TRUE = new Set(['true', 'sim', '1']);
const FALSE = new Set(['false', 'nao', 'não', '0']);

/**
 * Converte os params em texto (CLI `--param k=v`, formulário do painel) pelo tipo de cada campo. Vazio some (o
 * schema decide se faz falta); o que não converte fica como veio, e o schema recusa com a mensagem certa.
 */
export function coerceParams(def: TaskTypeDef, raw: Record<string, string>): Record<string, unknown> {
  const fields = new Map(paramFields(def).map((f) => [f.name, f]));
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const text = value.trim();
    if (text === '') continue;
    const kind = fields.get(name)?.kind ?? 'string';
    if (kind === 'number' || kind === 'integer') {
      const n = Number(text);
      out[name] = Number.isFinite(n) ? n : value;
    } else if (kind === 'boolean') {
      const lower = text.toLowerCase();
      out[name] = TRUE.has(lower) ? true : FALSE.has(lower) ? false : value;
    } else if (kind === 'json') {
      try {
        out[name] = JSON.parse(text);
      } catch {
        out[name] = value;
      }
    } else out[name] = value;
  }
  return out;
}

/** Problemas de validação em texto, um por campo (`campo: mensagem`). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    if (i.code === 'unrecognized_keys') return `${i.keys.join(', ')}: parâmetro desconhecido`;
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

const TYPE_NAMES: Record<string, string> = {
  string: 'um texto',
  number: 'um número',
  int: 'um número inteiro',
  boolean: 'sim ou não',
  array: 'uma lista',
  object: 'um objeto',
};

/** Mensagens da validação em pt-BR (a CLI e o painel mostram por campo); o resto cai no locale `pt` do zod. */
const ptBrError = (() => {
  const fallback = z.locales.pt().localeError;
  return (issue: Parameters<typeof fallback>[0]): string | undefined => {
    switch (issue.code) {
      case 'invalid_type':
        return issue.input === undefined
          ? 'obrigatório'
          : `esperava ${TYPE_NAMES[issue.expected] ?? issue.expected}`;
      case 'too_small':
        return issue.origin === 'string'
          ? `precisa ter pelo menos ${String(issue.minimum)} caractere(s)`
          : `precisa ser ${issue.inclusive ? 'no mínimo' : 'maior que'} ${String(issue.minimum)}`;
      case 'too_big':
        return issue.origin === 'string'
          ? `pode ter no máximo ${String(issue.maximum)} caractere(s)`
          : `precisa ser ${issue.inclusive ? 'no máximo' : 'menor que'} ${String(issue.maximum)}`;
      case 'invalid_value':
        return `use um destes: ${issue.values.map(String).join(', ')}`;
      case 'invalid_format':
        return 'formato inválido';
      default: {
        const message = fallback(issue);
        return typeof message === 'string' ? message : message?.message;
      }
    }
  };
})();

/** Valida os params do tipo (sem as chaves reservadas); chave desconhecida é recusada. */
export function parseParams(
  def: TaskTypeDef,
  params: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; issues: string[] } {
  const parsed = def.params.strict().safeParse(params ?? {}, { error: ptBrError });
  return parsed.success
    ? { ok: true, value: parsed.data as Record<string, unknown> }
    : { ok: false, issues: formatIssues(parsed.error) };
}

/**
 * Antes de executar (worker): o tipo existe, os params conferem e a tarefa destrutiva é prévia ou veio de uma
 * aprovação. Defesa em profundidade, para o `enqueue` direto não pular a regra. Devolve o motivo da recusa, ou null.
 */
export function checkRunnable(
  task: { type: string; params: unknown },
  registry: TaskRegistry = TASK_TYPES,
): string | null {
  const def = taskType(task.type, registry);
  if (!def) return `tipo de tarefa desconhecido: ${task.type}`;
  const meta = paramsMeta(task.params);
  if (def.destrutiva && !meta.previa && !meta.previaId)
    return `${task.type} é destrutiva: só roda em prévia ou aprovada (previaId)`;
  const parsed = parseParams(def, ownParams(task.params));
  return parsed.ok ? null : `params inválidos: ${parsed.issues.join('; ')}`;
}
