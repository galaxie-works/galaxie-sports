/**
 * Grava as biografias aceitas em data/knowledge/formula-1/participants/drivers.yaml como perfis `draft`
 * (o painel de revisão aprova; até lá a API não serve). Perfil já aprovado nunca é sobrescrito. Cada
 * alteração passa pelo validador do CI (`validateKnowledge`) antes de entrar.
 */
import { join } from 'node:path';
import { isMap, isSeq, parseDocument, YAMLMap } from 'yaml';
import {
  buildKnowledgeBase,
  parseKnowledgeFile,
  validateKnowledge,
  type KnowledgeBase,
} from '@galaxie/knowledge';
import { unifiedDiff } from '../curator/diff.js';
import type { BioProposal } from './propose.js';

export const DRIVERS_FILE = 'formula-1/participants/drivers.yaml';

export interface BioChanges {
  text: string | null;
  diff: string;
  applied: string[];
  skipped: { f1dbId: string; reason: string }[];
}

const slugOf = (f1dbId: string) => `f1-${f1dbId}`;

/** Entrada YAML do perfil (só campos com fonte; o vínculo vem do F1DB, nunca do LLM). */
function entryOf(p: BioProposal, previous: Record<string, unknown> | null): Record<string, unknown> {
  const f = p.facts;
  const prevNames = (previous?.names ?? {}) as Record<string, unknown>;
  return {
    slug: slugOf(f.f1dbId),
    names: {
      official: p.officialName ?? prevNames.official ?? f.name,
      short: prevNames.short ?? f.name,
      ...(f.abbreviation ? { abbreviation: f.abbreviation } : {}),
    },
    api_sports: { team_id: null, match: { name: f.name, country: f.country ?? 'World' } },
    f1db: { id: f.f1dbId },
    country: f.country ?? 'WORLD',
    ...(p.city ? { city: p.city } : {}),
    ...(p.region ? { region: p.region } : {}),
    nicknames: p.nicknames,
    identity: p.identity.map((s) => s.text),
    sources: [...new Set(p.identity.map((s) => s.source))],
    review_status: 'draft',
  };
}

export async function applyBios(kb: KnowledgeBase, proposals: BioProposal[]): Promise<BioChanges> {
  const file = kb.files.find((f) => f.rel === DRIVERS_FILE);
  if (!file) throw new Error(`${DRIVERS_FILE} não está na base`);
  const doc = parseDocument(file.source);
  const list = doc.get('participants');
  if (!isSeq(list)) throw new Error(`${DRIVERS_FILE}: participants não é lista`);
  const out: BioChanges = { text: null, diff: '', applied: [], skipped: [] };
  const baseline = new Set(
    (await validateKnowledge(kb)).errors.map((e) => `${e.file}|${e.code}|${e.message}`),
  );

  for (const p of proposals) {
    if (p.status !== 'accepted') continue;
    const idx = list.items.findIndex((item) => {
      if (!isMap(item)) return false;
      const js = item.toJSON() as { slug?: string; f1db?: { id?: string } };
      return js.f1db?.id === p.facts.f1dbId || js.slug === slugOf(p.facts.f1dbId);
    });
    const previous = idx >= 0 ? ((list.items[idx] as YAMLMap).toJSON() as Record<string, unknown>) : null;
    if (previous?.review_status === 'approved') {
      out.skipped.push({ f1dbId: p.facts.f1dbId, reason: 'perfil já aprovado: não é sobrescrito' });
      continue;
    }
    const entry = entryOf(p, previous);
    // aplicar de novo a mesma proposta não muda nada (idempotente)
    if (previous && JSON.stringify(entry) === JSON.stringify(previous)) {
      out.skipped.push({ f1dbId: p.facts.f1dbId, reason: 'já está igual no YAML' });
      continue;
    }
    const node = doc.createNode(entry);
    const before = list.items.slice();
    if (idx >= 0) list.items[idx] = node;
    else list.items.push(node);
    // revalida a base com o arquivo novo; erro novo desfaz a alteração
    const text = doc.toString({ lineWidth: 0 });
    const candidate = buildKnowledgeBase(
      kb.dir,
      kb.files.map((f) =>
        f.rel === DRIVERS_FILE ? parseKnowledgeFile(join(kb.dir, f.rel), f.rel, text) : f,
      ),
    );
    const fresh = (await validateKnowledge(candidate)).errors.filter(
      (e) => !baseline.has(`${e.file}|${e.code}|${e.message}`),
    );
    if (fresh.length) {
      list.items = before;
      out.skipped.push({
        f1dbId: p.facts.f1dbId,
        reason: `validador: ${fresh.map((e) => e.message).join('; ')}`,
      });
      continue;
    }
    out.applied.push(p.facts.f1dbId);
  }
  if (out.applied.length) {
    out.text = doc.toString({ lineWidth: 0 });
    out.diff = unifiedDiff(`data/knowledge/${DRIVERS_FILE}`, file.source, out.text);
  }
  return out;
}
