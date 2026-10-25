/**
 * Grava os perfis editoriais aceitos em data/knowledge/formula-1/editorial/<locale>.yaml como `draft` (o painel de
 * revisão aprova; até lá a API não serve). Perfil já aprovado nunca é sobrescrito, e aplicar de novo a mesma proposta
 * não muda nada. Cada alteração passa pelo validador do CI (`validateKnowledge`) antes de entrar; o original pt-BR
 * vai antes da tradução (a tradução sem original é erro).
 */
import { join } from 'node:path';
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import {
  buildKnowledgeBase,
  parseKnowledgeFile,
  validateKnowledge,
  type KnowledgeBase,
  type KnowledgeFile,
} from '@galaxie/knowledge';
import { unifiedDiff } from '../curator/diff.js';
import type { ProfileLocale, ProfileProposal } from './profile.js';

export const PROFILE_LOCALES: readonly ProfileLocale[] = ['pt-BR', 'es'];
export const editorialFile = (locale: ProfileLocale) => `formula-1/editorial/${locale}.yaml`;

export interface ProfileChanges {
  /** Arquivos alterados: o texto novo e o diff. */
  files: { rel: string; text: string; diff: string }[];
  /** `<locale>:<f1dbId>` aplicados. */
  applied: string[];
  skipped: { f1dbId: string; locale: ProfileLocale; reason: string }[];
}

const header = (locale: ProfileLocale) =>
  [
    `# Base semântica — perfil editorial dos pilotos de F1 (${locale}), schema v1.`,
    '# Gerado pelo agente f1:bio --perfil (pesquisa com fonte por item; números conferidos contra o F1DB) e',
    '# revisado no painel (Ajustes → Revisão). Critério de nível em docs/runbooks/f1-perfil-editorial.md.',
    'schema_version: 1',
    `locale: ${locale}`,
    'drivers: []',
    '',
  ].join('\n');

export async function applyProfiles(
  kb: KnowledgeBase,
  proposals: ProfileProposal[],
): Promise<ProfileChanges> {
  const out: ProfileChanges = { files: [], applied: [], skipped: [] };
  const sources = new Map(kb.files.map((f) => [f.rel, f.source]));
  // a base de trabalho acumula os arquivos já alterados nesta aplicação
  let working = kb;
  const baseline = new Set(
    (await validateKnowledge(kb)).errors.map((e) => `${e.file}|${e.code}|${e.message}`),
  );

  for (const locale of PROFILE_LOCALES) {
    const rel = editorialFile(locale);
    const before = sources.get(rel) ?? null;
    const doc = parseDocument(before ?? header(locale));
    const list = doc.get('drivers');
    if (!isSeq(list)) throw new Error(`${rel}: drivers não é lista`);
    let changed = false;
    for (const p of proposals) {
      const entry = p.entries[locale];
      if (p.status !== 'accepted' || !entry) continue;
      const idx = list.items.findIndex(
        (item) => isMap(item) && (item.toJSON() as { slug?: string }).slug === entry.slug,
      );
      const previous = idx >= 0 ? ((list.items[idx] as YAMLMap).toJSON() as Record<string, unknown>) : null;
      if (previous?.review_status === 'approved') {
        out.skipped.push({ f1dbId: p.f1dbId, locale, reason: 'perfil já aprovado: não é sobrescrito' });
        continue;
      }
      if (previous && JSON.stringify(previous) === JSON.stringify(entry)) {
        out.skipped.push({ f1dbId: p.f1dbId, locale, reason: 'já está igual no YAML' });
        continue;
      }
      const saved = list.items.slice();
      const node = doc.createNode(entry);
      if (idx >= 0) list.items[idx] = node;
      else list.items.push(node);
      // revalida a base com o arquivo novo; erro novo desfaz a alteração
      const text = doc.toString({ lineWidth: 0 });
      const candidate = buildKnowledgeBase(working.dir, replaceFile(working, rel, text));
      const fresh = (await validateKnowledge(candidate)).errors.filter(
        (e) => !baseline.has(`${e.file}|${e.code}|${e.message}`),
      );
      if (fresh.length) {
        list.items = saved;
        out.skipped.push({
          f1dbId: p.f1dbId,
          locale,
          reason: `validador: ${fresh.map((e) => e.message).join('; ')}`,
        });
        continue;
      }
      working = candidate;
      changed = true;
      out.applied.push(`${locale}:${p.f1dbId}`);
    }
    if (changed) {
      const text = doc.toString({ lineWidth: 0 });
      out.files.push({ rel, text, diff: unifiedDiff(`data/knowledge/${rel}`, before ?? '', text) });
    }
  }
  return out;
}

/** Os arquivos da base com `rel` trocado (ou acrescentado) pelo texto novo. */
function replaceFile(base: KnowledgeBase, rel: string, text: string): KnowledgeFile[] {
  const parsed = parseKnowledgeFile(join(base.dir, rel), rel, text);
  return base.files.some((f) => f.rel === rel)
    ? base.files.map((f) => (f.rel === rel ? parsed : f))
    : [...base.files, parsed];
}
