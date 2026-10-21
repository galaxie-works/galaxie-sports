import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, isSeq, LineCounter, parseDocument, type Document } from 'yaml';
import type {
  CompetitionEntry,
  CopyFile,
  CopyTemplateEntry,
  DerbyEntry,
  ParticipantsFile,
  TeamEntry,
  TeamsFile,
} from './types.js';

/** data/knowledge na raiz do repositório (vale tanto para src/ quanto para dist/). */
export const DEFAULT_KNOWLEDGE_DIR = fileURLToPath(new URL('../../../data/knowledge', import.meta.url));

export type FileKind =
  'teams' | 'national-teams' | 'participants' | 'derbies' | 'competitions' | 'copy' | 'unknown';

/**
 * Esportes com pasta própria em data/knowledge (`<esporte>/teams`, `<esporte>/derbies`,
 * `<esporte>/participants`). Os slugs são os do `core.sport`; a NBA fica em `basketball`.
 */
export const KNOWLEDGE_SPORTS = [
  'football',
  'afl',
  'american-football',
  'baseball',
  'basketball',
  'formula-1',
  'handball',
  'hockey',
  'mma',
  'rugby',
  'volleyball',
] as const;
export type KnowledgeSport = (typeof KNOWLEDGE_SPORTS)[number];

/** Tipo do participante de cada arquivo `<esporte>/participants/*.yaml` (campo `kind` no topo). */
export const PARTICIPANT_KINDS = ['driver', 'constructor', 'fighter', 'athlete'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export interface KnowledgeFile {
  /** Caminho absoluto. */
  path: string;
  /** Caminho relativo a data/knowledge, com "/" (ex.: football/teams/br.yaml). */
  rel: string;
  kind: FileKind;
  source: string;
  doc: Document;
  lineCounter: LineCounter;
  /** Mensagens de erro de sintaxe YAML (vazio quando o arquivo é válido). */
  yamlErrors: { message: string; line: number | null }[];
  data: unknown;
}

export interface Located<T> {
  /** Arquivo relativo (football/teams/br.yaml). */
  file: string;
  /** Posição do item na lista do arquivo. */
  index: number;
  entry: T;
}

export type LocatedTeam = Located<TeamEntry> & {
  countryCode: string;
  kind: 'club' | 'national_team' | ParticipantKind;
  /** Esporte da pasta do arquivo (football, basketball, volleyball, formula-1...). */
  sport: KnowledgeSport;
  /** Chave da lista no arquivo (`teams` ou `participants`), para localizar linhas. */
  listKey: 'teams' | 'participants';
};
export type LocatedDerby = Located<DerbyEntry> & { sport: KnowledgeSport };
export type LocatedCopyTemplate = Located<CopyTemplateEntry> & { locale: string; sport: string };

export interface KnowledgeBase {
  dir: string;
  files: KnowledgeFile[];
  teams: LocatedTeam[];
  derbies: LocatedDerby[];
  competitions: Located<CompetitionEntry>[];
  copyTemplates: LocatedCopyTemplate[];
}

/** Classifica um arquivo pelo caminho relativo dentro de data/knowledge. */
export function fileKind(rel: string): FileKind {
  const sport = sportOf(rel);
  if (sport && /^[a-z0-9-]+\/teams\/[a-z0-9-]+\.ya?ml$/.test(rel)) return 'teams';
  if (rel === 'football/national-teams.yaml') return 'national-teams';
  if (sport && /^[a-z0-9-]+\/participants\/[a-z0-9-]+\.ya?ml$/.test(rel)) return 'participants';
  if (sport && /^[a-z0-9-]+\/derbies\/[a-z0-9-]+\.ya?ml$/.test(rel)) return 'derbies';
  if (/^competitions\/[a-z0-9-]+\.ya?ml$/.test(rel)) return 'competitions';
  if (/^copy\/[A-Za-z-]+\.ya?ml$/.test(rel)) return 'copy';
  return 'unknown';
}

/** Esporte da primeira pasta do caminho relativo (`basketball/teams/br.yaml` → basketball), ou null. */
export function sportOf(rel: string): KnowledgeSport | null {
  const first = rel.split('/')[0] ?? '';
  return (KNOWLEDGE_SPORTS as readonly string[]).includes(first) ? (first as KnowledgeSport) : null;
}

async function listYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listYamlFiles(full)));
    else if (/\.ya?ml$/.test(e.name)) out.push(full);
  }
  return out.sort();
}

/** Faz o parse de um YAML guardando o documento (para localizar linhas e reescrever sem perder comentários). */
export function parseKnowledgeFile(path: string, rel: string, source: string): KnowledgeFile {
  const lineCounter = new LineCounter();
  // version 1.2 (padrão): datas ficam como string ISO, que é o que o schema espera.
  const doc = parseDocument(source, { lineCounter, prettyErrors: false, uniqueKeys: true });
  const yamlErrors = doc.errors.map((e) => ({
    message: e.message.split('\n')[0] ?? e.message,
    line: e.pos ? lineCounter.linePos(e.pos[0]).line : null,
  }));
  const data = yamlErrors.length ? null : doc.toJS();
  return { path, rel, kind: fileKind(rel), source, doc, lineCounter, yamlErrors, data };
}

/** Linha (1-based) do nó apontado por `path` no arquivo, ou null se não existir. */
export function lineOf(file: KnowledgeFile, path: (string | number)[]): number | null {
  let node: unknown = file.doc.contents;
  let lastRange: [number, number, number] | null = null;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === key);
      if (!pair) break;
      node = pair.value;
    } else if (isSeq(node) && typeof key === 'number') {
      node = node.items[key];
    } else break;
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (range) lastRange = range;
  }
  return lastRange ? file.lineCounter.linePos(lastRange[0]).line : null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function items<T>(file: KnowledgeFile, key: string): Located<T>[] {
  if (!isObject(file.data)) return [];
  const list = file.data[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry, index) =>
    isObject(entry) && typeof entry['slug'] === 'string'
      ? [{ file: file.rel, index, entry: entry as T }]
      : [],
  );
}

/** Lê todos os YAML de data/knowledge e indexa times, clássicos, competições e templates de copy. */
export async function loadKnowledge(dir: string = DEFAULT_KNOWLEDGE_DIR): Promise<KnowledgeBase> {
  const paths = await listYamlFiles(dir);
  const files: KnowledgeFile[] = [];
  for (const path of paths) {
    const rel = relative(dir, path).split(sep).join('/');
    files.push(parseKnowledgeFile(path, rel, await readFile(path, 'utf8')));
  }
  return buildKnowledgeBase(dir, files);
}

export function buildKnowledgeBase(dir: string, files: KnowledgeFile[]): KnowledgeBase {
  const kb: KnowledgeBase = { dir, files, teams: [], derbies: [], competitions: [], copyTemplates: [] };
  for (const file of files) {
    switch (file.kind) {
      case 'teams': {
        const country = String((file.data as Partial<TeamsFile> | null)?.country ?? '');
        for (const t of items<TeamEntry>(file, 'teams'))
          kb.teams.push({
            ...t,
            countryCode: t.entry.country ?? country,
            kind: 'club',
            sport: sportOf(file.rel)!,
            listKey: 'teams',
          });
        break;
      }
      case 'national-teams': {
        for (const t of items<TeamEntry>(file, 'teams'))
          kb.teams.push({
            ...t,
            countryCode: t.entry.country ?? '',
            kind: 'national_team',
            sport: 'football',
            listKey: 'teams',
          });
        break;
      }
      case 'participants': {
        const declared = (file.data as Partial<ParticipantsFile> | null)?.kind;
        const kind = (PARTICIPANT_KINDS as readonly string[]).includes(String(declared))
          ? (declared as ParticipantKind)
          : 'athlete';
        for (const t of items<TeamEntry>(file, 'participants'))
          kb.teams.push({
            ...t,
            countryCode: t.entry.country ?? '',
            kind,
            sport: sportOf(file.rel)!,
            listKey: 'participants',
          });
        break;
      }
      case 'derbies':
        kb.derbies.push(
          ...items<DerbyEntry>(file, 'derbies').map((d) => ({ ...d, sport: sportOf(file.rel)! })),
        );
        break;
      case 'competitions':
        kb.competitions.push(...items<CompetitionEntry>(file, 'competitions'));
        break;
      case 'copy': {
        const data = file.data as Partial<CopyFile> | null;
        const list = Array.isArray(data?.templates) ? data.templates : [];
        list.forEach((entry, index) => {
          if (isObject(entry) && typeof entry['key'] === 'string')
            kb.copyTemplates.push({
              file: file.rel,
              index,
              entry: entry as unknown as CopyTemplateEntry,
              locale: String(data?.locale ?? ''),
              sport: String(data?.sport ?? ''),
            });
        });
        break;
      }
      default:
        break;
    }
  }
  return kb;
}
