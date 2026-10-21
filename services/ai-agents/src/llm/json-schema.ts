/** Validação das saídas estruturadas do LLM contra o JSON Schema pedido (ajv). */
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { LlmError } from './errors.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<string, ValidateFunction>();

function compile(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let fn = cache.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    cache.set(key, fn);
  }
  return fn;
}

function describe(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '(raiz)'} ${e.message ?? ''}`.trim())
    .join('; ');
}

/** Lança LlmError(kind: schema, retryable) quando a saída não segue o schema. */
export function assertMatchesSchema<T>(
  schema: Record<string, unknown>,
  data: unknown,
  schemaName: string,
): T {
  const validate = compile(schema);
  if (!validate(data))
    throw new LlmError(`Saída fora do schema ${schemaName}: ${describe(validate.errors)}`, 'schema', true);
  return data as T;
}

/** Faz o parse do texto JSON do modelo (tolerando cercas ```json). */
export function parseJsonOutput(text: string, schemaName: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new LlmError(`Saída do modelo não é JSON válido (${schemaName}).`, 'schema', true);
  }
}

/**
 * Verifica se o schema é compatível com o modo estrito das saídas estruturadas (OpenAI): todo objeto
 * com `additionalProperties: false` e todas as propriedades em `required`. Devolve os caminhos problemáticos.
 */
export function strictSchemaProblems(schema: unknown, path = '#'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const out: string[] = [];
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('object') && s.properties) {
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties deve ser false`);
    const props = Object.keys(s.properties as object);
    const req = new Set((s.required as string[] | undefined) ?? []);
    for (const p of props) if (!req.has(p)) out.push(`${path}.${p}: deve estar em required`);
    for (const [k, v] of Object.entries(s.properties as object))
      out.push(...strictSchemaProblems(v, `${path}.${k}`));
  }
  if (s.items) out.push(...strictSchemaProblems(s.items, `${path}[]`));
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
    if (Array.isArray(s[key]))
      (s[key] as unknown[]).forEach((x, i) => out.push(...strictSchemaProblems(x, `${path}.${key}[${i}]`)));
  return out;
}
