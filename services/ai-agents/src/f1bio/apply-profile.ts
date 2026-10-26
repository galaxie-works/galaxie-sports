/**
 * Grava os perfis editoriais aceitos em data/knowledge/formula-1/editorial/<locale>.yaml como `draft` (o painel de
 * revisão aprova; até lá a API não serve). Perfil já aprovado nunca é sobrescrito — aprovado no YAML ou no painel
 * (`semantic.review_decision`, que vale enquanto o conteúdo for o mesmo: trocar o texto desfaria a aprovação e o perfil
 * sumiria da API), salvo `overwriteApproved` no aprovado pelo painel. Aplicar de novo a mesma proposta não muda nada.
 * Cada alteração passa pelo validador do CI (`validateKnowledge`) antes de entrar; o original pt-BR vai antes da
 * tradução (a tradução sem original é erro). Só se grava texto que vale: a tradução da proposta só entra se o original
 * dela entrou (ou já estava igual no YAML); com o pt-BR aprovado mantido, a tradução nova não é gravada e fica
 * pendente de revisão.
 */
import { join } from 'node:path';
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import {
  applyEditorialDecisions,
  applyEditorialOverrides,
  buildKnowledgeBase,
  editorialKey,
  parseKnowledgeFile,
  validateKnowledge,
  type KnowledgeBase,
  type KnowledgeFile,
  type ReviewDecisionRef,
  type ReviewOverrideRef,
} from '@galaxie/knowledge';
import { unifiedDiff } from '../curator/diff.js';
import type { ProfileLocale, ProfileProposal } from './profile.js';

/** O original vem antes das traduções (a ordem decide se a tradução tem original gravado). */
export const PROFILE_LOCALES: readonly ProfileLocale[] = ['pt-BR', 'es'];
const ORIGINAL_LOCALE: ProfileLocale = 'pt-BR';

/** Motivo da tradução que não entra porque o original da proposta não entrou. */
const pendingTranslation = (originReason: string) =>
  `tradução de um original (pt-BR) que não foi gravado (${originReason}): não vai para o YAML; ` +
  'fica pendente de revisão a tradução do texto que vale no pt-BR';
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

export interface ApplyProfilesOptions {
  /** Decisões do painel (`semantic.review_decision`, itens `editorial:*`). */
  decisions?: ReviewDecisionRef[];
  /** Edições aprovadas fora do YAML (`semantic.review_override`), aplicadas antes das decisões, como na API. */
  overrides?: ReviewOverrideRef[];
  /** Sobrescreve também o perfil aprovado pelo painel (o do YAML aprovado continua intocado). */
  overwriteApproved?: boolean;
}

export async function applyProfiles(
  kb: KnowledgeBase,
  proposals: ProfileProposal[],
  options: ApplyProfilesOptions = {},
): Promise<ProfileChanges> {
  const out: ProfileChanges = { files: [], applied: [], skipped: [] };
  // status que a API serve hoje: o YAML com as edições e as decisões do painel por cima
  const panelApproved = new Set(
    applyEditorialDecisions(
      applyEditorialOverrides(kb.editorial, options.overrides ?? []),
      options.decisions ?? [],
    )
      .filter((p) => p.entry.review_status === 'approved')
      .map(editorialKey),
  );
  const sources = new Map(kb.files.map((f) => [f.rel, f.source]));
  // a base de trabalho acumula os arquivos já alterados nesta aplicação
  let working = kb;
  const baseline = new Set(
    (await validateKnowledge(kb)).errors.map((e) => `${e.file}|${e.code}|${e.message}`),
  );

  // por piloto, o original (pt-BR) da proposta: entrou (ou já estava igual no YAML) ou por que não entrou
  const origin = new Map<string, { ok: true } | { ok: false; reason: string }>();

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
      // tradução só entra com o próprio original: se o pt-BR da proposta não foi gravado (aprovado no painel, no
      // YAML ou recusado pelo validador), o es é tradução de um texto que não vale e não vai para o YAML
      const source = locale === ORIGINAL_LOCALE ? null : origin.get(p.f1dbId);
      if (source && !source.ok) {
        out.skipped.push({ f1dbId: p.f1dbId, locale, reason: source.reason });
        continue;
      }
      const skip = (reason: string) => {
        out.skipped.push({ f1dbId: p.f1dbId, locale, reason });
        if (locale === ORIGINAL_LOCALE)
          origin.set(p.f1dbId, { ok: false, reason: pendingTranslation(reason) });
      };
      const idx = list.items.findIndex(
        (item) => isMap(item) && (item.toJSON() as { slug?: string }).slug === entry.slug,
      );
      const previous = idx >= 0 ? ((list.items[idx] as YAMLMap).toJSON() as Record<string, unknown>) : null;
      if (previous?.review_status === 'approved') {
        skip('perfil já aprovado: não é sobrescrito');
        continue;
      }
      if (!options.overwriteApproved && panelApproved.has(editorialKey({ locale, entry }))) {
        skip('perfil aprovado no painel: não é sobrescrito (--sobrescrever-aprovados para trocar)');
        continue;
      }
      if (previous && JSON.stringify(previous) === JSON.stringify(entry)) {
        out.skipped.push({ f1dbId: p.f1dbId, locale, reason: 'já está igual no YAML' });
        if (locale === ORIGINAL_LOCALE) origin.set(p.f1dbId, { ok: true });
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
        skip(`validador: ${fresh.map((e) => e.message).join('; ')}`);
        continue;
      }
      working = candidate;
      changed = true;
      if (locale === ORIGINAL_LOCALE) origin.set(p.f1dbId, { ok: true });
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
