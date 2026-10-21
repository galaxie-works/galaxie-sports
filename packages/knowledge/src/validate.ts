import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { lineOf, type FileKind, type KnowledgeBase, type KnowledgeFile } from './load.js';
import { checkChant, checkProse, type LyricVerdict } from './lyrics.js';
import { COPY_INTENTS, COPY_LOCALES, COPY_PLACEHOLDERS, type CopyTemplateEntry } from './types.js';

export interface Issue {
  level: 'error' | 'warning';
  /** Código estável da regra (ex.: schema, duplicate-slug, rival-not-symmetric). */
  code: string;
  file: string | null;
  line: number | null;
  message: string;
}

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
  counts: {
    files: number;
    teams: number;
    derbies: number;
    competitions: number;
    copyTemplates: number;
    glossaryTerms: number;
  };
}

const SCHEMA_BY_KIND: Partial<Record<FileKind, string>> = {
  teams: 'teams.schema.json',
  'national-teams': 'national-teams.schema.json',
  derbies: 'derbies.schema.json',
  competitions: 'competitions.schema.json',
  copy: 'copy.schema.json',
  glossary: 'glossary.schema.json',
};

/** Compila os JSON Schemas de data/knowledge/schemas. */
export async function compileSchemas(dir: string): Promise<Map<string, ValidateFunction>> {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
  });
  const schemaDir = join(dir, 'schemas');
  const names = (await readdir(schemaDir)).filter((n) => n.endsWith('.schema.json')).sort();
  for (const name of names) ajv.addSchema(JSON.parse(await readFile(join(schemaDir, name), 'utf8')), name);
  const out = new Map<string, ValidateFunction>();
  for (const name of Object.values(SCHEMA_BY_KIND)) {
    const fn = ajv.getSchema(name);
    if (!fn) throw new Error(`JSON Schema ausente: schemas/${name}`);
    out.set(name, fn);
  }
  return out;
}

function pointerToPath(pointer: string): (string | number)[] {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

function describeError(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required':
      return `campo obrigatório ausente: ${String(p['missingProperty'])}`;
    case 'additionalProperties':
      return `campo não previsto no schema: ${String(p['additionalProperty'])}`;
    case 'enum':
      return `valor fora da lista permitida (${(p['allowedValues'] as unknown[]).map(String).join(', ')})`;
    case 'const':
      return `valor deve ser ${JSON.stringify(p['allowedValue'])}`;
    case 'type':
      return `tipo inválido (esperado ${String(p['type'])})`;
    case 'pattern':
      return `formato inválido (padrão ${String(p['pattern'])})`;
    case 'minItems':
      return `lista precisa de pelo menos ${String(p['limit'])} item(ns)`;
    case 'maxItems':
      return `lista aceita no máximo ${String(p['limit'])} item(ns)`;
    case 'minLength':
      return `texto vazio ou curto demais (mín. ${String(p['limit'])})`;
    case 'maxLength':
      return `texto longo demais (máx. ${String(p['limit'])} caracteres)`;
    case 'minimum':
    case 'maximum':
      return `valor fora do intervalo (${e.keyword === 'minimum' ? 'mín.' : 'máx.'} ${String(p['limit'])})`;
    case 'uniqueItems':
      return 'lista com itens repetidos';
    case 'propertyNames':
      return `chave não permitida: ${String(p['propertyName'])}`;
    default:
      return e.message ?? e.keyword;
  }
}

/** Rótulo legível do caminho, com o slug do item quando houver (ex.: teams[3] palmeiras › rivals[0]). */
function describePath(file: KnowledgeFile, path: (string | number)[]): string {
  const parts: string[] = [];
  let node: unknown = file.data;
  for (const key of path) {
    node = (node as Record<string | number, unknown> | null)?.[key];
    if (typeof key === 'number') {
      const slug =
        (node as { slug?: unknown; key?: unknown } | null)?.slug ?? (node as { key?: unknown })?.key;
      parts[parts.length - 1] += `[${key}]${typeof slug === 'string' ? ` ${slug}` : ''}`;
    } else parts.push(key);
  }
  return parts.join(' › ');
}

function schemaIssues(file: KnowledgeFile, validate: ValidateFunction): Issue[] {
  if (validate(file.data)) return [];
  const errors = validate.errors ?? [];
  // oneOf/anyOf repetem o erro dos ramos — mostra só se for o único erro naquele caminho.
  const paths = new Set(
    errors.filter((e) => !['oneOf', 'anyOf', 'allOf'].includes(e.keyword)).map((e) => e.instancePath),
  );
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const e of errors) {
    if (['oneOf', 'anyOf', 'allOf'].includes(e.keyword) && paths.has(e.instancePath)) continue;
    const msg = describeError(e);
    const sig = `${e.instancePath}|${msg}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const path = pointerToPath(e.instancePath);
    const where = describePath(file, path);
    out.push({
      level: 'error',
      code: 'schema',
      file: file.rel,
      line: lineOf(file, path),
      message: `${where ? `${where}: ` : ''}${msg}`,
    });
  }
  return out;
}

/** Valida a base inteira: sintaxe, JSON Schema e regras cruzadas (slugs, referências, fontes, letras, copy). */
export async function validateKnowledge(kb: KnowledgeBase): Promise<ValidationReport> {
  const issues: Issue[] = [];
  const fileByRel = new Map(kb.files.map((f) => [f.rel, f]));
  const at = (file: string, path: (string | number)[]) => {
    const f = fileByRel.get(file);
    return f ? lineOf(f, path) : null;
  };
  const add = (
    level: Issue['level'],
    code: string,
    file: string | null,
    line: number | null,
    message: string,
  ) => issues.push({ level, code, file, line, message });

  // 1. sintaxe e layout
  const schemas = await compileSchemas(kb.dir);
  const schemaValid = new Set<string>();
  for (const file of kb.files) {
    for (const e of file.yamlErrors) add('error', 'yaml', file.rel, e.line, `YAML inválido: ${e.message}`);
    if (file.yamlErrors.length) continue;
    if (file.kind === 'unknown') {
      add('error', 'layout', file.rel, null, 'arquivo fora da estrutura de data/knowledge (ver SCHEMA.md)');
      continue;
    }
    const schemaName = SCHEMA_BY_KIND[file.kind]!;
    const found = schemaIssues(file, schemas.get(schemaName)!);
    issues.push(...found);
    if (!found.length) schemaValid.add(file.rel);

    // 2. coerência do nome do arquivo
    const data = file.data as Record<string, unknown> | null;
    const base = file.rel
      .split('/')
      .pop()!
      .replace(/\.ya?ml$/, '');
    if (
      file.kind === 'teams' &&
      typeof data?.['country'] === 'string' &&
      data['country'].toLowerCase() !== base
    )
      add(
        'warning',
        'file-name',
        file.rel,
        lineOf(file, ['country']),
        `country ${data['country']} difere do nome do arquivo`,
      );
    if (file.kind === 'derbies' && typeof data?.['region'] === 'string' && data['region'] !== base)
      add(
        'warning',
        'file-name',
        file.rel,
        lineOf(file, ['region']),
        `region ${data['region']} difere do nome do arquivo`,
      );
    if ((file.kind === 'copy' || file.kind === 'glossary') && data?.['locale'] !== base)
      add(
        'error',
        'file-name',
        file.rel,
        lineOf(file, ['locale']),
        `locale ${String(data?.['locale'])} difere do nome do arquivo`,
      );
  }

  // 3. slugs únicos (por tipo = erro; entre tipos = aviso)
  const namespaces: [string, { slug: string; file: string; path: (string | number)[] }[]][] = [
    [
      'time/seleção',
      kb.teams.map((t) => ({ slug: t.entry.slug, file: t.file, path: ['teams', t.index, 'slug'] })),
    ],
    [
      'clássico',
      kb.derbies.map((d) => ({ slug: d.entry.slug, file: d.file, path: ['derbies', d.index, 'slug'] })),
    ],
    [
      'competição',
      kb.competitions.map((c) => ({
        slug: c.entry.slug,
        file: c.file,
        path: ['competitions', c.index, 'slug'],
      })),
    ],
  ];
  const owner = new Map<string, string>();
  for (const [label, list] of namespaces) {
    const seen = new Map<string, string>();
    for (const item of list) {
      const prev = seen.get(item.slug);
      if (prev)
        add(
          'error',
          'duplicate-slug',
          item.file,
          at(item.file, item.path),
          `slug de ${label} duplicado: ${item.slug} (já em ${prev})`,
        );
      else seen.set(item.slug, item.file);
      const other = owner.get(item.slug);
      if (other && other !== label)
        add(
          'warning',
          'slug-collision',
          item.file,
          at(item.file, item.path),
          `slug ${item.slug} também é usado por um(a) ${other}`,
        );
      owner.set(item.slug, label);
    }
  }

  // 4. IDs da api-sports únicos
  const teamIds = new Map<number, string>();
  for (const t of kb.teams) {
    const id = t.entry.api_sports?.team_id;
    if (typeof id !== 'number') continue;
    const prev = teamIds.get(id);
    if (prev)
      add(
        'error',
        'duplicate-provider-id',
        t.file,
        at(t.file, ['teams', t.index, 'api_sports', 'team_id']),
        `api_sports.team_id ${id} repetido (${prev} e ${t.entry.slug})`,
      );
    else teamIds.set(id, t.entry.slug);
  }
  const leagueIds = new Map<number, string>();
  for (const c of kb.competitions) {
    const id = c.entry.api_sports_league_id;
    if (typeof id !== 'number') continue;
    const prev = leagueIds.get(id);
    if (prev)
      add(
        'error',
        'duplicate-provider-id',
        c.file,
        at(c.file, ['competitions', c.index, 'api_sports_league_id']),
        `api_sports_league_id ${id} repetido (${prev} e ${c.entry.slug})`,
      );
    else leagueIds.set(id, c.entry.slug);
  }

  // 5. referências: clássicos ↔ times ↔ rivais
  const teams = new Map(kb.teams.map((t) => [t.entry.slug, t]));
  const derbies = new Map(kb.derbies.map((d) => [d.entry.slug, d]));
  for (const d of kb.derbies) {
    const list = Array.isArray(d.entry.teams) ? d.entry.teams : [];
    list.forEach((slug, i) => {
      if (!teams.has(slug))
        add(
          'error',
          'unknown-team',
          d.file,
          at(d.file, ['derbies', d.index, 'teams', i]),
          `clássico ${d.entry.slug}: time inexistente ${slug}`,
        );
    });
    const [a, b] = list;
    if (a && b && teams.has(a) && teams.has(b)) {
      const rivalsOf = (s: string) => (teams.get(s)!.entry.rivals ?? []).map((r) => r.team);
      if (!rivalsOf(a).includes(b) && !rivalsOf(b).includes(a))
        add(
          'warning',
          'derby-without-rival',
          d.file,
          at(d.file, ['derbies', d.index, 'slug']),
          `clássico ${d.entry.slug}: nenhum dos dois times lista o outro em rivals`,
        );
    }
  }
  for (const t of kb.teams) {
    const rivals = Array.isArray(t.entry.rivals) ? t.entry.rivals : [];
    rivals.forEach((r, i) => {
      const path = ['teams', t.index, 'rivals', i];
      const line = at(t.file, path);
      if (r.team === t.entry.slug)
        add('error', 'self-rival', t.file, line, `${t.entry.slug} lista a si mesmo como rival`);
      const rival = teams.get(r.team);
      if (!rival) add('error', 'unknown-team', t.file, line, `${t.entry.slug}: rival inexistente ${r.team}`);
      if (r.derby) {
        const d = derbies.get(r.derby);
        if (!d)
          add('error', 'unknown-derby', t.file, line, `${t.entry.slug}: clássico inexistente ${r.derby}`);
        else {
          const pair = d.entry.teams ?? [];
          if (!pair.includes(t.entry.slug) || !pair.includes(r.team))
            add(
              'error',
              'derby-mismatch',
              t.file,
              line,
              `${t.entry.slug} × ${r.team}: o clássico ${r.derby} é entre ${pair.join(' × ')}`,
            );
          else if (typeof r.intensity === 'number' && r.intensity !== d.entry.intensity)
            add(
              'warning',
              'intensity-mismatch',
              t.file,
              line,
              `${t.entry.slug} × ${r.team}: intensity ${r.intensity} difere da do clássico ${r.derby} (${d.entry.intensity})`,
            );
        }
      }
      if (rival && !(rival.entry.rivals ?? []).some((rr) => rr.team === t.entry.slug))
        add(
          'warning',
          'rival-not-symmetric',
          t.file,
          line,
          `${t.entry.slug} lista ${r.team} como rival, mas ${r.team} não lista ${t.entry.slug}`,
        );
    });
  }

  // 6. fontes repetidas no mesmo item (a presença é garantida pelo schema)
  const sourceOwners: [string, string, (string | number)[], unknown][] = [
    ...kb.teams.map(
      (t) =>
        [t.file, t.entry.slug, ['teams', t.index, 'sources'], t.entry.sources] as [
          string,
          string,
          (string | number)[],
          unknown,
        ],
    ),
    ...kb.derbies.map(
      (d) =>
        [d.file, d.entry.slug, ['derbies', d.index, 'sources'], d.entry.sources] as [
          string,
          string,
          (string | number)[],
          unknown,
        ],
    ),
    ...kb.competitions.map(
      (c) =>
        [c.file, c.entry.slug, ['competitions', c.index, 'sources'], c.entry.sources] as [
          string,
          string,
          (string | number)[],
          unknown,
        ],
    ),
  ];
  for (const [file, slug, path, sources] of sourceOwners) {
    if (!Array.isArray(sources)) continue;
    if (new Set(sources).size !== sources.length)
      add('warning', 'duplicate-source', file, at(file, path), `${slug}: URL repetida em sources`);
  }

  // 7. heurística de letra de música
  const flag = (
    verdict: LyricVerdict,
    file: string,
    path: (string | number)[],
    who: string,
    text: string,
  ) => {
    if (!verdict) return;
    const excerpt = text.length > 50 ? `${text.slice(0, 47)}…` : text;
    add(verdict.level, 'lyric-like', file, at(file, path), `${who}: "${excerpt}" ${verdict.reason}`);
  };
  for (const t of kb.teams) {
    const base = ['teams', t.index];
    (t.entry.rallying_cries ?? []).forEach(
      (s, i) =>
        typeof s === 'string' && flag(checkChant(s), t.file, [...base, 'rallying_cries', i], t.entry.slug, s),
    );
    for (const [loc, hints] of Object.entries(t.entry.copy_hints ?? {}))
      (hints?.cheer ?? []).forEach(
        (s, i) =>
          typeof s === 'string' &&
          flag(checkChant(s), t.file, [...base, 'copy_hints', loc, 'cheer', i], t.entry.slug, s),
      );
    (t.entry.identity ?? []).forEach(
      (s, i) =>
        typeof s === 'string' && flag(checkProse(s), t.file, [...base, 'identity', i], t.entry.slug, s),
    );
  }
  for (const d of kb.derbies) {
    const base = ['derbies', d.index];
    if (typeof d.entry.origin === 'string')
      flag(checkProse(d.entry.origin), d.file, [...base, 'origin'], d.entry.slug, d.entry.origin);
    (d.entry.trivia ?? []).forEach(
      (s, i) => typeof s === 'string' && flag(checkProse(s), d.file, [...base, 'trivia', i], d.entry.slug, s),
    );
  }

  // 8. biblioteca de copy
  issues.push(...validateCopy(kb, at));

  // 9. glossário por mercado
  issues.push(...validateGlossary(kb, at));

  const sortKey = (i: Issue) => `${i.file ?? ''}|${String(i.line ?? 0).padStart(6, '0')}`;
  const sorted = issues.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return {
    errors: sorted.filter((i) => i.level === 'error'),
    warnings: sorted.filter((i) => i.level === 'warning'),
    counts: {
      files: kb.files.length,
      teams: kb.teams.length,
      derbies: kb.derbies.length,
      competitions: kb.competitions.length,
      copyTemplates: kb.copyTemplates.length,
      glossaryTerms: kb.glossary.length,
    },
  };
}

/** Placeholders usados no template, ex.: "Vai, {team}!" → ["team"]. */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!);
}

function validateCopy(
  kb: KnowledgeBase,
  at: (file: string, path: (string | number)[]) => number | null,
): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], code: string, file: string, line: number | null, message: string) =>
    out.push({ level, code, file, line, message });
  const byLocale = new Map<string, { file: string; entry: CopyTemplateEntry }[]>();
  const keys = new Set<string>();
  for (const t of kb.copyTemplates) {
    const path = ['templates', t.index];
    const line = at(t.file, path);
    const e = t.entry;
    const fullKey = `${t.locale}.${e.key}`;
    if (keys.has(fullKey)) add('error', 'duplicate-key', t.file, line, `chave de copy duplicada: ${e.key}`);
    keys.add(fullKey);
    if (!byLocale.has(t.locale)) byLocale.set(t.locale, []);
    byLocale.get(t.locale)!.push({ file: t.file, entry: e });
    if (typeof e.template !== 'string') continue;
    for (const p of templatePlaceholders(e.template))
      if (!(COPY_PLACEHOLDERS as readonly string[]).includes(p))
        add(
          'error',
          'copy-placeholder',
          t.file,
          line,
          `${e.key}: placeholder desconhecido {${p}} (use ${COPY_PLACEHOLDERS.map((x) => `{${x}}`).join(', ')})`,
        );
    if (/[{}]/.test(e.template.replace(/\{[^{}]*\}/g, '')))
      add('error', 'copy-placeholder', t.file, line, `${e.key}: chaves desbalanceadas no template`);
    const chant = checkChant(e.template);
    if (chant) add(chant.level, 'lyric-like', t.file, line, `${e.key}: ${chant.reason}`);
    // copy_permission (docs/06 §4.2) refletida nos próprios templates
    if (e.intent === 'rivalry' && e.affinity_source === 'inferred')
      add(
        'error',
        'copy-permission',
        t.file,
        line,
        `${e.key}: copy de rivalidade nunca pode mirar afinidade inferida`,
      );
    if (e.intent === 'rivalry' && e.affinity_type && e.affinity_type !== 'rival')
      add('error', 'copy-permission', t.file, line, `${e.key}: rivalry só vale para affinity_type rival`);
    if (e.affinity_source === 'inferred' && (e.intent !== 'inform' || e.tone > 1))
      add(
        'error',
        'copy-permission',
        t.file,
        line,
        `${e.key}: afinidade inferida só aceita copy informativa (inform, tom 1)`,
      );
    if (
      e.intent === 'rivalry' &&
      /\{rival\}/.test(e.template) === false &&
      /\{team\}/.test(e.template) === false
    )
      add('warning', 'copy-placeholder', t.file, line, `${e.key}: copy de rivalidade sem {rival} nem {team}`);
  }
  // cobertura mínima: os 8 mercados, todas as intenções, os 4 tons
  for (const locale of COPY_LOCALES) {
    const list = byLocale.get(locale);
    if (!list) {
      if (kb.copyTemplates.length)
        add('warning', 'copy-coverage', 'copy', null, `sem biblioteca de copy para ${locale}`);
      continue;
    }
    const file = list[0]!.file;
    for (const intent of COPY_INTENTS)
      if (!list.some((t) => t.entry.intent === intent))
        add('warning', 'copy-coverage', file, null, `${locale}: nenhuma copy com intent ${intent}`);
    for (const tone of [1, 2, 3, 4])
      if (!list.some((t) => t.entry.tone === tone))
        add('warning', 'copy-coverage', file, null, `${locale}: nenhuma copy com tom ${tone}`);
  }
  return out;
}

/**
 * Glossário (data/knowledge/glossary/<locale>.yaml): chaves únicas por locale, termos curtos e positivos e
 * as mesmas regras do copy_permission — termo de rivalidade só com rival declarado; torcida só com
 * afinidade declarada.
 */
function validateGlossary(
  kb: KnowledgeBase,
  at: (file: string, path: (string | number)[]) => number | null,
): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], code: string, file: string, line: number | null, message: string) =>
    out.push({ level, code, file, line, message });
  const keys = new Set<string>();
  const locales = new Set<string>();
  for (const t of kb.glossary) {
    const e = t.entry;
    const line = at(t.file, ['terms', t.index]);
    locales.add(t.locale);
    const fullKey = `${t.locale}.${e.key}`;
    if (keys.has(fullKey))
      add('error', 'duplicate-key', t.file, line, `termo de glossário duplicado: ${e.key}`);
    keys.add(fullKey);
    const intents = Array.isArray(e.copy_intents) ? e.copy_intents : [];
    if ((e.category === 'rivalry' || intents.includes('rivalry')) && e.requires !== 'declared_rival')
      add(
        'error',
        'copy-permission',
        t.file,
        line,
        `${e.key}: termo de rivalidade exige requires: declared_rival (docs/06 §4.2)`,
      );
    if (intents.includes('cheer') && !e.requires)
      add(
        'warning',
        'copy-permission',
        t.file,
        line,
        `${e.key}: termo de torcida (cheer) sem requires — use declared_affinity`,
      );
    for (const field of ['meaning', 'note'] as const) {
      const text = e[field];
      if (typeof text !== 'string') continue;
      const verdict = checkProse(text);
      if (verdict)
        add(
          verdict.level,
          'lyric-like',
          t.file,
          at(t.file, ['terms', t.index, field]),
          `${e.key}: ${verdict.reason}`,
        );
    }
    if (typeof e.example === 'string') {
      const verdict = checkChant(e.example);
      if (verdict)
        add(
          verdict.level,
          'lyric-like',
          t.file,
          at(t.file, ['terms', t.index, 'example']),
          `${e.key}: ${verdict.reason}`,
        );
    }
  }
  if (kb.glossary.length)
    for (const locale of COPY_LOCALES)
      if (!locales.has(locale))
        add('warning', 'glossary-coverage', 'glossary', null, `sem glossário para ${locale}`);
  return out;
}

/** Formata o relatório para terminal (pt-BR). */
export function formatReport(report: ValidationReport): string {
  const line = (i: Issue) =>
    `  ${i.level === 'error' ? '✗' : '!'} ${i.file ?? '-'}${i.line ? `:${i.line}` : ''} [${i.code}] ${i.message}`;
  const c = report.counts;
  return [
    `Base semântica: ${c.files} arquivos · ${c.teams} times/seleções · ${c.derbies} clássicos · ${c.competitions} competições · ${c.copyTemplates} templates de copy · ${c.glossaryTerms} termos de glossário`,
    ...(report.errors.length ? [`Erros (${report.errors.length}):`, ...report.errors.map(line)] : []),
    ...(report.warnings.length ? [`Avisos (${report.warnings.length}):`, ...report.warnings.map(line)] : []),
    report.errors.length
      ? `✗ ${report.errors.length} erro(s) — corrija antes do merge.`
      : `✓ Nenhum erro${report.warnings.length ? ` (${report.warnings.length} aviso(s))` : ''}.`,
  ].join('\n');
}
