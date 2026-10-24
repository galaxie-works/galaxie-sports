import { isMap, parseDocument } from 'yaml';
import type { KnowledgeBase, KnowledgeFile, LocatedGlossaryTerm } from './load.js';
import {
  buildReviewItems,
  canonicalJson,
  glossaryKey,
  reviewContent,
  reviewItemId,
  type ReviewKind,
} from './review.js';

/**
 * Edições de conteúdo aprovadas fora do YAML (`semantic.review_override`, docs/06 §2.1). Hoje quem
 * grava é o agente de revisão de sugestões (`review-suggestions`): a sugestão do painel aceita pelo
 * modelo e pela validação determinística entra no ar como registro no banco, sem PR nem deploy.
 *
 * - A edição é campo a campo, nas chaves de primeiro nível do conteúdo do item (o mesmo `content` de
 *   `semantic.review_item`): `fields` traz o valor novo (null = remover o campo) e `base`, o valor do
 *   YAML quando a edição foi feita.
 * - O seed e a API (glossário) aplicam a edição por cima do YAML. Para cada campo: YAML = `base` →
 *   aplica; YAML = valor novo → já exportado (absorvido); YAML com um terceiro valor → conflito, e vale
 *   o YAML (alguém mudou o mesmo campo no repositório depois; a decisão fica desatualizada pelo hash).
 * - Com a edição aplicada, o `review_hash` do item é o do conteúdo editado: a aprovação gravada junto
 *   continua valendo no próximo deploy, e também depois de o YAML receber a edição (`review:export`).
 */

export interface ReviewOverrideRef {
  itemId: string;
  fields: Record<string, unknown>;
  base: Record<string, unknown>;
}

export type OverrideStatus = 'apply' | 'absorbed' | 'conflict' | 'missing';

/** Campos que identificam o item ou o ligam a outros dados: nunca entram numa edição. */
const LOCKED_COMMON = ['slug', 'key', 'review_status'] as const;
const LOCKED_BY_KIND: Record<ReviewKind, readonly string[]> = {
  team: ['country', 'api_sports', 'f1db'],
  derby: ['teams'],
  'all-time': ['teams'],
  competition: ['api_sports_league_id'],
  copy: [],
  glossary: [],
  translation: [],
};

export const lockedReviewFields = (kind: ReviewKind): ReadonlySet<string> =>
  new Set([...LOCKED_COMMON, ...LOCKED_BY_KIND[kind]]);

/** Campos do conteúdo que uma edição pode mudar (os presentes no item, menos os travados). */
export function editableReviewFields(kind: ReviewKind, content: Record<string, unknown>): string[] {
  const locked = lockedReviewFields(kind);
  return Object.keys(content).filter((k) => !locked.has(k));
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Como a edição se encaixa no conteúdo atual do YAML (ver o comentário do módulo). */
export function resolveOverride(
  current: Record<string, unknown> | null | undefined,
  override: Pick<ReviewOverrideRef, 'fields' | 'base'>,
): OverrideStatus {
  if (!current) return 'missing';
  let pending = 0;
  for (const [field, next] of Object.entries(override.fields)) {
    const now = current[field];
    if (same(now, next)) continue;
    if (!same(now, override.base[field])) return 'conflict';
    pending++;
  }
  return pending ? 'apply' : 'absorbed';
}

/** Conteúdo com os campos trocados (null/undefined = remove o campo). */
export function patchContent(
  content: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...content };
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Item do YAML com a edição aplicada. No histórico geral (`all-time`) o conteúdo é
 * `{ teams, all_time }` e o status mora dentro do bloco: troca o bloco e mantém o review_status.
 */
export function patchEntry<T extends object>(kind: ReviewKind, entry: T, fields: Record<string, unknown>): T {
  const e = entry as Record<string, unknown>;
  if (kind === 'all-time') {
    if (!('all_time' in fields)) return entry;
    const current = (e['all_time'] ?? {}) as Record<string, unknown>;
    const next = fields['all_time'];
    return {
      ...e,
      all_time:
        next && typeof next === 'object'
          ? { ...(next as Record<string, unknown>), review_status: current['review_status'] }
          : undefined,
    } as T;
  }
  const { review_status: status, ...rest } = e;
  const patched = patchContent(rest, fields);
  return (status === undefined ? patched : { ...patched, review_status: status }) as T;
}

type ListName = 'teams' | 'derbies' | 'headToHead' | 'competitions' | 'copyTemplates' | 'glossary' | 'texts';

interface Located {
  kind: ReviewKind;
  list: ListName;
  index: number;
  file: string;
  /** Caminho do item em `file.data` (ex.: ['teams', 3]). */
  path: [string, number];
}

/** Onde mora cada item revisável (lista da base e caminho no arquivo). */
function locateItems(kb: KnowledgeBase): Map<string, Located> {
  const out = new Map<string, Located>();
  kb.teams.forEach((t, i) =>
    out.set(reviewItemId('team', t.entry.slug), {
      kind: 'team',
      list: 'teams',
      index: i,
      file: t.file,
      path: [t.listKey, t.index],
    }),
  );
  kb.derbies.forEach((d, i) => {
    const at = {
      list: 'derbies' as const,
      index: i,
      file: d.file,
      path: ['derbies', d.index] as [string, number],
    };
    out.set(reviewItemId('derby', d.entry.slug), { kind: 'derby', ...at });
    if (d.entry.all_time)
      out.set(reviewItemId('all-time', `derby:${d.entry.slug}`), { kind: 'all-time', ...at });
  });
  kb.headToHead.forEach((p, i) =>
    out.set(reviewItemId('all-time', `pair:${p.entry.slug}`), {
      kind: 'all-time',
      list: 'headToHead',
      index: i,
      file: p.file,
      path: ['pairs', p.index],
    }),
  );
  kb.competitions.forEach((c, i) =>
    out.set(reviewItemId('competition', c.entry.slug), {
      kind: 'competition',
      list: 'competitions',
      index: i,
      file: c.file,
      path: ['competitions', c.index],
    }),
  );
  kb.copyTemplates.forEach((t, i) =>
    out.set(reviewItemId('copy', `${t.locale}.${t.entry.key}`), {
      kind: 'copy',
      list: 'copyTemplates',
      index: i,
      file: t.file,
      path: ['templates', t.index],
    }),
  );
  kb.glossary.forEach((g, i) =>
    out.set(reviewItemId('glossary', glossaryKey(g)), {
      kind: 'glossary',
      list: 'glossary',
      index: i,
      file: g.file,
      path: ['terms', g.index],
    }),
  );
  kb.texts.forEach((x, i) =>
    out.set(
      reviewItemId('translation', `${x.listKey === 'teams' ? 'team' : 'derby'}:${x.entry.slug}`, x.locale),
      { kind: 'translation', list: 'texts', index: i, file: x.file, path: [x.listKey, x.index] },
    ),
  );
  return out;
}

export interface AppliedOverrides {
  /** A base com as edições aplicadas (listas e `file.data`, para a validação ver o mesmo conteúdo). */
  kb: KnowledgeBase;
  applied: string[];
  absorbed: string[];
  conflicts: string[];
  /** Edições de itens que não existem mais no YAML. */
  missing: string[];
}

/** Aplica as edições do banco por cima da base lida do YAML (sem tocar nos arquivos). */
export function applyReviewOverrides(kb: KnowledgeBase, overrides: ReviewOverrideRef[]): AppliedOverrides {
  const result: AppliedOverrides = { kb, applied: [], absorbed: [], conflicts: [], missing: [] };
  if (!overrides.length) return result;
  const located = locateItems(kb);
  const contents = new Map(buildReviewItems(kb).map((i) => [i.id, i.content]));
  const lists: Partial<Record<ListName, { entry: object }[]>> = {};
  // várias edições podem mexer no mesmo item do YAML (o clássico e o histórico geral dele): a segunda
  // parte do item já editado pela primeira
  const data = new Map<string, Record<string, unknown>>();

  for (const o of overrides) {
    const at = located.get(o.itemId);
    const status = at ? resolveOverride(contents.get(o.itemId), o) : 'missing';
    if (status === 'missing') result.missing.push(o.itemId);
    else if (status === 'conflict') result.conflicts.push(o.itemId);
    else if (status === 'absorbed') result.absorbed.push(o.itemId);
    if (status !== 'apply' || !at) continue;
    result.applied.push(o.itemId);

    const list = (lists[at.list] ??= [...(kb[at.list] as { entry: object }[])]);
    const entry = patchEntry(at.kind, list[at.index]!.entry, o.fields);
    list[at.index] = { ...list[at.index]!, entry };

    const file = kb.files.find((f) => f.rel === at.file);
    if (!file || !file.data || typeof file.data !== 'object') continue;
    const fileData = data.get(at.file) ?? structuredClone(file.data as Record<string, unknown>);
    data.set(at.file, fileData);
    const target = fileData[at.path[0]];
    if (Array.isArray(target)) target[at.path[1]] = structuredClone(entry);
  }
  if (!result.applied.length) return result;
  const files: KnowledgeFile[] = kb.files.map((f) => (data.has(f.rel) ? { ...f, data: data.get(f.rel) } : f));
  result.kb = { ...kb, ...lists, files } as KnowledgeBase;
  return result;
}

/**
 * Edições do banco sobre o glossário lido do YAML (a API lê o glossário direto dos arquivos). Aplique
 * antes de `applyGlossaryDecisions`: o hash da decisão aprovada junto é o do conteúdo editado.
 */
export function applyGlossaryOverrides(
  terms: LocatedGlossaryTerm[],
  overrides: ReviewOverrideRef[],
): LocatedGlossaryTerm[] {
  if (!overrides.length) return terms;
  const byId = new Map(overrides.map((o) => [o.itemId, o]));
  return terms.map((t) => {
    const o = byId.get(reviewItemId('glossary', glossaryKey(t)));
    if (!o || resolveOverride(reviewContent(t.entry), o) !== 'apply') return t;
    return { ...t, entry: patchEntry('glossary', t.entry, o.fields) };
  });
}

/**
 * Junta uma edição nova à que já existe no item: os campos novos vencem, e o `base` de cada campo é o
 * do YAML (o da edição anterior, se o campo já tinha sido editado; senão o valor atual, que ainda é o
 * do YAML).
 */
export function mergeOverride(
  previous: Pick<ReviewOverrideRef, 'fields' | 'base'> | null,
  fields: Record<string, unknown>,
  current: Record<string, unknown>,
): Pick<ReviewOverrideRef, 'fields' | 'base'> {
  const merged = { fields: { ...(previous?.fields ?? {}) }, base: { ...(previous?.base ?? {}) } };
  for (const [k, v] of Object.entries(fields)) {
    if (!(k in merged.base)) merged.base[k] = current[k] ?? null;
    merged.fields[k] = v ?? null;
  }
  return merged;
}

// ─── exportação para o YAML ─────────────────────────────────────────────────────────────────────

export interface OverrideExport {
  /** Texto novo por arquivo (relativo a data/knowledge). */
  files: Map<string, string>;
  exported: string[];
  skipped: { itemId: string; status: OverrideStatus }[];
}

/**
 * Leva as edições que ainda se aplicam para o texto dos YAML (para um PR): troca só os campos
 * editados, mantendo o resto do documento (comentários e ordem). O status de revisão do YAML não
 * muda: a aprovação continua na decisão do painel, que segue valendo com o mesmo conteúdo.
 */
export function exportOverridesToYaml(kb: KnowledgeBase, overrides: ReviewOverrideRef[]): OverrideExport {
  const out: OverrideExport = { files: new Map(), exported: [], skipped: [] };
  const located = locateItems(kb);
  const contents = new Map(buildReviewItems(kb).map((i) => [i.id, i.content]));
  const docs = new Map<string, ReturnType<typeof parseDocument>>();
  for (const o of overrides) {
    const at = located.get(o.itemId);
    const status = at ? resolveOverride(contents.get(o.itemId), o) : 'missing';
    if (status !== 'apply' || !at) {
      out.skipped.push({ itemId: o.itemId, status });
      continue;
    }
    const file = kb.files.find((f) => f.rel === at.file);
    if (!file) {
      out.skipped.push({ itemId: o.itemId, status: 'missing' });
      continue;
    }
    const doc = docs.get(at.file) ?? parseDocument(file.source);
    docs.set(at.file, doc);
    const node = doc.getIn(at.path, true);
    if (!isMap(node)) {
      out.skipped.push({ itemId: o.itemId, status: 'missing' });
      continue;
    }
    for (const [field, value] of Object.entries(o.fields)) {
      if (at.kind === 'all-time') {
        if (field !== 'all_time' || !value || typeof value !== 'object') continue;
        const block = node.get('all_time', true);
        const status = isMap(block) ? block.get('review_status') : undefined;
        node.set(
          'all_time',
          doc.createNode({ ...(value as object), ...(status ? { review_status: status } : {}) }),
        );
      } else if (value === null || value === undefined) node.delete(field);
      else node.set(field, doc.createNode(value));
    }
    out.exported.push(o.itemId);
  }
  for (const [rel, doc] of docs) out.files.set(rel, doc.toString({ lineWidth: 0 }));
  return out;
}
