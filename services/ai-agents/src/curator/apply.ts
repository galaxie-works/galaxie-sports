import { join } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, Scalar, stringify } from 'yaml';
import {
  buildKnowledgeBase,
  parseKnowledgeFile,
  validateKnowledge,
  type Issue,
  type KnowledgeBase,
  type TeamEntry,
} from '@galaxie/knowledge';
import { unifiedDiff } from './diff.js';
import {
  entryTextLocale,
  type AddTeamProposal,
  type CuratorProposal,
  type UpdateStadiumProposal,
} from './propose.js';

/**
 * Aplica as propostas aceitas aos YAML **em memória**, uma a uma, revalidando a base inteira
 * (mesmo validador do CI: `validateKnowledge`). Proposta que cria erro novo é revertida e
 * reprovada. Nada é gravado em disco aqui.
 */

export interface AppliedChanges {
  /** Conteúdo novo por arquivo (relativo a data/knowledge). */
  files: Map<string, string>;
  /** Conteúdo original (null = arquivo novo). */
  originals: Map<string, string | null>;
  diff: string;
  /** Erros do validador que impediram propostas (para o relatório). */
  validation: Issue[];
}

function itemIndent(source: string): string {
  return /^([ \t]*)- slug:/m.exec(source)?.[1] ?? '  ';
}

/** Acrescenta um time no fim da lista `teams` sem reformatar o resto do arquivo. */
export function appendTeam(source: string | null, countryCode: string, entry: TeamEntry): string {
  const base =
    source ??
    [
      `# Base semântica — clubes (${countryCode.toUpperCase()}) (schema v1)`,
      '# Arquivo criado pelo Agente Curador Semântico; revise antes de aprovar.',
      'schema_version: 1',
      // o curador escreve identity na voz do país (es-AR, es-PY…, ou es); docs/06 §3.3
      ...(entryTextLocale(countryCode) !== 'pt-BR' ? [`text_locale: ${entryTextLocale(countryCode)}`] : []),
      `country: ${countryCode.toUpperCase()}`,
      'teams:',
      '',
    ].join('\n');
  const indent = source ? itemIndent(source) : '  ';
  const snippet = stringify([entry], { lineWidth: 0, indent: 2 })
    .trimEnd()
    .split('\n')
    .map((l) => indent + l)
    .join('\n');
  const header =
    '# Proposta do Agente Curador Semântico (review_status: draft) — revisar fontes antes de aprovar.';
  const next = `${base.replace(/\s*$/, '')}\n${indent}${header}\n${snippet}\n`;
  // confere que o time entrou como último item de `teams` (senão reescreve pelo documento)
  const doc = parseDocument(next);
  const teams = isMap(doc.contents) ? doc.contents.get('teams', true) : null;
  const last = isSeq(teams) ? teams.items.at(-1) : null;
  if (!doc.errors.length && isMap(last) && last.get('slug') === entry.slug) return next;
  const fallback = parseDocument(base);
  const list = isMap(fallback.contents) ? fallback.contents.get('teams', true) : null;
  if (!isSeq(list)) throw new Error('arquivo sem lista "teams"');
  list.add(fallback.createNode(entry));
  return fallback.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** Troca o nome do estádio (o antigo vira apelido), acrescenta fontes e volta a entrada para draft. */
export function updateStadium(source: string, p: UpdateStadiumProposal): string {
  const doc = parseDocument(source);
  const path = ['teams', p.gap.index];
  const item = doc.getIn(path, true);
  if (!isMap(item) || item.get('slug') !== p.gap.slug)
    throw new Error(`time ${p.gap.slug} fora da posição esperada`);
  if (item.get('review_status') === 'approved')
    throw new Error('entrada approved não é alterada pelo curador');
  const name = p.currentName!;
  const nicknames = [p.gap.yamlStadium, ...p.gap.yamlNicknames, ...p.previousNames].filter(
    (n, i, all) => n !== name && all.indexOf(n) === i,
  );

  // Edição cirúrgica pelo intervalo de cada nó (como o resolve:ids): o resto do arquivo fica igual.
  const edits: { start: number; end: number; text: string }[] = [];
  const quoted = (value: string, like: unknown) =>
    isScalar(like) && like.type === Scalar.QUOTE_DOUBLE ? JSON.stringify(value) : stringify(value).trim();
  const lineStart = (offset: number) => source.lastIndexOf('\n', offset - 1) + 1;
  const indentAt = (offset: number) => /^[ \t]*/.exec(source.slice(lineStart(offset)))![0];

  const nameNode = doc.getIn([...path, 'stadium', 'name'], true);
  if (!isScalar(nameNode) || !nameNode.range) throw new Error(`${p.gap.slug}: stadium.name ausente`);
  edits.push({ start: nameNode.range[0], end: nameNode.range[1], text: quoted(name, nameNode) });

  const nickNode = doc.getIn([...path, 'stadium', 'nicknames'], true);
  if (isSeq(nickNode) && nickNode.flow && nickNode.range) {
    const like = nickNode.items[0];
    edits.push({
      start: nickNode.range[0],
      end: nickNode.range[1],
      text: `[${nicknames.map((n) => quoted(n, like)).join(', ')}]`,
    });
  } else if (!nickNode) {
    const like = new Scalar('');
    like.type = Scalar.QUOTE_DOUBLE;
    const lineEnd = source.indexOf('\n', nameNode.range[0]);
    edits.push({
      start: lineEnd,
      end: lineEnd,
      text: `\n${indentAt(nameNode.range[0])}nicknames: [${nicknames.map((n) => quoted(n, like)).join(', ')}]`,
    });
  } else throw new Error(`${p.gap.slug}: formato de stadium.nicknames não suportado`);

  const sources = doc.getIn([...path, 'sources'], true);
  if (!isSeq(sources) || sources.flow || !sources.items.length)
    throw new Error(`${p.gap.slug}: sources inesperado`);
  const known = new Set(sources.items.map((s) => (isScalar(s) ? String(s.value) : '')));
  const last = sources.items.at(-1);
  if (isScalar(last) && last.range) {
    const indent = indentAt(last.range[0]);
    const extra = p.sources.filter((u) => !known.has(u)).map((u) => `\n${indent}- ${quoted(u, last)}`);
    const lineEnd = source.indexOf('\n', last.range[0]);
    const at = lineEnd < 0 ? source.length : lineEnd;
    if (extra.length) edits.push({ start: at, end: at, text: extra.join('') });
  }

  const status = item.get('review_status', true);
  if (isScalar(status) && status.range && status.value !== 'draft')
    edits.push({ start: status.range[0], end: status.range[1], text: 'draft' });

  let next = source;
  for (const e of edits.sort((a, b) => b.start - a.start))
    next = next.slice(0, e.start) + e.text + next.slice(e.end);

  // confere o resultado
  const check = parseDocument(next).getIn(path) as { toJSON?: () => unknown } | undefined;
  const entry = (check?.toJSON?.() ?? check) as TeamEntry | undefined;
  if (
    entry?.stadium?.name !== name ||
    JSON.stringify(entry.stadium.nicknames ?? []) !== JSON.stringify(nicknames) ||
    entry.review_status !== 'draft' ||
    !p.sources.every((s) => entry.sources.includes(s))
  )
    throw new Error(`${p.gap.slug}: falha ao editar o YAML`);
  return next;
}

function issueKey(i: Issue): string {
  return `${i.file}|${i.code}|${i.message}`;
}

/** Aplica, valida e calcula o diff. Atualiza `status`/`reasons` das propostas reprovadas pelo validador. */
export async function applyProposals(
  kb: KnowledgeBase,
  proposals: CuratorProposal[],
): Promise<AppliedChanges> {
  const originalByRel = new Map(kb.files.map((f) => [f.rel, f.source]));
  const files = new Map<string, string>();
  const originals = new Map<string, string | null>();
  const baseline = await validateKnowledge(kb);
  const baselineKeys = new Set(baseline.errors.map(issueKey));
  const validation: Issue[] = [];

  const kbWith = (changes: Map<string, string>): KnowledgeBase => {
    const parsed = kb.files.map((f) =>
      changes.has(f.rel) ? parseKnowledgeFile(f.path, f.rel, changes.get(f.rel)!) : f,
    );
    for (const [rel, source] of changes) {
      if (!originalByRel.has(rel)) parsed.push(parseKnowledgeFile(join(kb.dir, rel), rel, source));
    }
    return buildKnowledgeBase(kb.dir, parsed);
  };

  for (const p of proposals) {
    if (p.status !== 'accepted' || p.kind === 'resolve_id') continue;
    const rel = p.file;
    const before = files.get(rel) ?? originalByRel.get(rel) ?? null;
    let after: string;
    try {
      after =
        p.kind === 'add_team'
          ? appendTeam(before, (p as AddTeamProposal).gap.countryCode!, (p as AddTeamProposal).entry!)
          : updateStadium(before ?? '', p);
    } catch (err) {
      p.status = 'rejected';
      p.reasons.push(`não foi possível aplicar: ${(err as Error).message}`);
      continue;
    }
    const attempt = new Map(files);
    attempt.set(rel, after);
    const candidate = kbWith(attempt);
    const report = await validateKnowledge(candidate);
    const fresh = report.errors.filter((e) => !baselineKeys.has(issueKey(e)));
    if (fresh.length) {
      p.status = 'rejected';
      p.reasons.push(...fresh.map((e) => `validador: ${e.message}${e.line ? ` (linha ${e.line})` : ''}`));
      validation.push(...fresh);
      continue;
    }
    if (!originals.has(rel)) originals.set(rel, originalByRel.get(rel) ?? null);
    files.set(rel, after);
  }

  const diff = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, text]) => unifiedDiff(`data/knowledge/${rel}`, originals.get(rel) ?? null, text))
    .join('');
  return { files, originals, diff, validation };
}
