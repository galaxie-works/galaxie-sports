import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { nameKey } from '@galaxie/db';
import {
  lineOf,
  type FileKind,
  type KnowledgeBase,
  type KnowledgeFile,
  type LocatedDerby,
  type LocatedTeam,
} from './load.js';
import { guessLanguage, languageOf } from './language.js';
import { driverSlug } from './editorial.js';
import { checkChant, checkProse, type LyricVerdict } from './lyrics.js';
import {
  COPY_INTENTS,
  COPY_LOCALES,
  COPY_PLACEHOLDERS,
  REVIEW_STATUSES,
  type CopyTemplateEntry,
  type DerbyAllTimeEntry,
} from './types.js';

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
    /** Clássicos com `all_time` (histórico geral curado). */
    derbiesWithAllTime: number;
    /** Pares que não são clássicos, com histórico geral curado. */
    headToHead: number;
    competitions: number;
    copyTemplates: number;
    glossaryTerms: number;
    /** Traduções (time ou clássico × locale) em i18n/<locale>.yaml. */
    texts: number;
    /** Épocas de pintura de construtores da F1 (formula-1/liveries.yaml). */
    liveryEras: number;
    /** Perfis editoriais de pilotos da F1 (piloto × idioma, formula-1/editorial/<locale>.yaml). */
    editorial: number;
  };
}

const SCHEMA_BY_KIND: Partial<Record<FileKind, string>> = {
  teams: 'teams.schema.json',
  'national-teams': 'national-teams.schema.json',
  participants: 'participants.schema.json',
  derbies: 'derbies.schema.json',
  'head-to-head': 'head-to-head.schema.json',
  competitions: 'competitions.schema.json',
  copy: 'copy.schema.json',
  glossary: 'glossary.schema.json',
  i18n: 'i18n.schema.json',
  liveries: 'liveries.schema.json',
  editorial: 'editorial.schema.json',
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
    if (
      (file.kind === 'copy' ||
        file.kind === 'glossary' ||
        file.kind === 'i18n' ||
        file.kind === 'editorial') &&
      data?.['locale'] !== base
    )
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
      kb.teams.map((t) => ({ slug: t.entry.slug, file: t.file, path: [t.listKey, t.index, 'slug'] })),
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

  // 3b. F1DB: só na Fórmula 1 e um perfil por piloto/construtor
  const f1dbIds = new Map<string, string>();
  for (const t of kb.teams) {
    const id = t.entry.f1db?.id;
    if (!id) continue;
    const idPath = at(t.file, [t.listKey, t.index, 'f1db', 'id']);
    if (t.sport !== 'formula-1') {
      add('error', 'provider-id-sport', t.file, idPath, `${t.entry.slug}: f1db só vale na Fórmula 1`);
      continue;
    }
    const key = `${t.kind}:${id}`;
    const prev = f1dbIds.get(key);
    if (prev)
      add(
        'error',
        'duplicate-provider-id',
        t.file,
        idPath,
        `${t.entry.slug}: f1db.id ${id} já está em ${prev}`,
      );
    else f1dbIds.set(key, t.entry.slug);
  }

  // 3c. pinturas da F1: um item por construtor, épocas em ordem e sem sobreposição; só a última fica em aberto
  const liverySlugs = new Map<string, number>();
  for (const l of kb.liveries) {
    const base = ['constructors', l.index];
    const prev = liverySlugs.get(l.entry.slug);
    if (prev !== undefined)
      add(
        'error',
        'duplicate-slug',
        l.file,
        at(l.file, [...base, 'slug']),
        `pinturas de ${l.entry.slug} repetidas (já no item ${prev + 1})`,
      );
    else liverySlugs.set(l.entry.slug, l.index);
    const eras = Array.isArray(l.entry.eras) ? l.entry.eras : [];
    eras.forEach((era, i) => {
      const where = at(l.file, [...base, 'eras', i]);
      const to = era.to ?? Infinity;
      if (to < era.from)
        add('error', 'livery-years', l.file, where, `${l.entry.slug}: época ${era.from}–${era.to} invertida`);
      if (era.to === null && i < eras.length - 1)
        add(
          'error',
          'livery-years',
          l.file,
          where,
          `${l.entry.slug}: só a última época pode ficar em aberto`,
        );
      const next = eras[i + 1];
      if (next && next.from <= to)
        add(
          'error',
          'livery-years',
          l.file,
          at(l.file, [...base, 'eras', i + 1]),
          `${l.entry.slug}: época ${next.from} começa antes do fim da anterior (${era.to ?? 'aberta'})`,
        );
    });
  }

  // 4. IDs da api-sports únicos (por esporte: cada API tem os seus IDs)
  const teamIds = new Map<string, string>();
  for (const t of kb.teams) {
    const id = t.entry.api_sports?.team_id;
    if (typeof id !== 'number') continue;
    const idPath = at(t.file, [t.listKey, t.index, 'api_sports', 'team_id']);
    // o seed e o resolve:ids ligam perfis a participantes só no futebol; nos demais o ID fica para depois
    if (t.sport !== 'football') {
      add(
        'error',
        'provider-id-sport',
        t.file,
        idPath,
        `${t.entry.slug}: api_sports.team_id ainda não é suportado em ${t.sport} (use null; a vinculação é só no futebol)`,
      );
      continue;
    }
    const key = `${t.sport}:${id}`;
    const prev = teamIds.get(key);
    if (prev)
      add(
        'error',
        'duplicate-provider-id',
        t.file,
        idPath,
        `api_sports.team_id ${id} repetido (${prev} e ${t.entry.slug})`,
      );
    else teamIds.set(key, t.entry.slug);
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

  // 4b. estádios: nomes anteriores coerentes e api_sports_venue_id sem conflito
  const venueOwners = new Map<number, { slug: string; name: string }>();
  for (const t of kb.teams) {
    const st = t.entry.stadium;
    if (!st || typeof st.name !== 'string') continue;
    const path = [t.listKey, t.index, 'stadium'];
    const current = nameKey(st.name);
    const nicknames = new Set((st.nicknames ?? []).map(nameKey));
    const seen = new Set<string>();
    (st.former_names ?? []).forEach((f, i) => {
      const key = nameKey(f.name);
      const where = at(t.file, [...path, 'former_names', i, 'name']);
      if (key === current)
        add(
          'error',
          'stadium-former-name',
          t.file,
          where,
          `${t.entry.slug}: nome anterior igual ao atual (${f.name})`,
        );
      else if (seen.has(key))
        add(
          'error',
          'stadium-former-name',
          t.file,
          where,
          `${t.entry.slug}: nome anterior repetido (${f.name})`,
        );
      else if (nicknames.has(key))
        add(
          'warning',
          'stadium-former-nickname',
          t.file,
          where,
          `${t.entry.slug}: ${f.name} está em nicknames e em former_names (deixe só em former_names)`,
        );
      seen.add(key);
    });
    const id = st.api_sports_venue_id;
    if (typeof id !== 'number') continue;
    const idPath = at(t.file, [...path, 'api_sports_venue_id']);
    if (t.sport !== 'football') {
      add(
        'error',
        'provider-id-sport',
        t.file,
        idPath,
        `${t.entry.slug}: stadium.api_sports_venue_id só é suportado no futebol`,
      );
      continue;
    }
    const prev = venueOwners.get(id);
    if (prev && nameKey(prev.name) !== current)
      add(
        'error',
        'stadium-conflict',
        t.file,
        idPath,
        `api_sports_venue_id ${id} com nomes diferentes (${prev.slug}: ${prev.name}; ${t.entry.slug}: ${st.name})`,
      );
    else if (!prev) venueOwners.set(id, { slug: t.entry.slug, name: st.name });
  }

  // 5. referências: clássicos ↔ times ↔ rivais
  const teams = new Map(kb.teams.map((t) => [t.entry.slug, t]));
  const derbies = new Map(kb.derbies.map((d) => [d.entry.slug, d]));
  /** Histórico geral curado: mesmos times do par, soma que fecha, gols dos dois lados ou de nenhum. */
  const checkAllTime = (
    who: string,
    pair: string[],
    allTime: DerbyAllTimeEntry | undefined,
    file: string,
    path: (string | number)[],
  ) => {
    if (!allTime || !Array.isArray(allTime.teams)) return;
    const where = at(file, path);
    const sides = allTime.teams.map((t) => t.team);
    if ([...pair].sort().join() !== [...sides].sort().join())
      add(
        'error',
        'all-time-teams',
        file,
        where,
        `${who}: all_time.teams (${sides.join(' × ')}) difere de teams (${pair.join(' × ')})`,
      );
    const wins = allTime.teams.reduce((n, t) => n + t.wins, 0);
    if (wins + allTime.draws !== allTime.matches)
      add(
        'error',
        'all-time-sum',
        file,
        where,
        `${who}: vitórias (${wins}) + empates (${allTime.draws}) ≠ jogos (${allTime.matches})`,
      );
    if (new Set(allTime.teams.map((t) => t.goals == null)).size > 1)
      add(
        'error',
        'all-time-goals',
        file,
        where,
        `${who}: all_time com gols de um lado só (os dois ou nenhum)`,
      );
    if (typeof allTime.as_of === 'string' && allTime.as_of > new Date().toISOString().slice(0, 10))
      add('error', 'all-time-future', file, where, `${who}: as_of no futuro`);
  };
  // pares que não são clássicos: times existentes, do mesmo esporte, slug único e sem repetir um clássico
  const derbyPairs = new Map(kb.derbies.map((d) => [[...d.entry.teams].sort().join('|'), d.entry.slug]));
  const pairSlugs = new Set<string>();
  for (const p of kb.headToHead) {
    const list = Array.isArray(p.entry.teams) ? p.entry.teams : [];
    const who = `confronto ${p.entry.slug}`;
    if (pairSlugs.has(p.entry.slug))
      add('error', 'duplicate-slug', p.file, at(p.file, ['pairs', p.index, 'slug']), `${who}: slug repetido`);
    pairSlugs.add(p.entry.slug);
    list.forEach((slug, i) => {
      const team = teams.get(slug);
      const line = at(p.file, ['pairs', p.index, 'teams', i]);
      if (!team) add('error', 'unknown-team', p.file, line, `${who}: time inexistente ${slug}`);
      else if (team.sport !== p.sport)
        add(
          'error',
          'head-to-head-cross-sport',
          p.file,
          line,
          `${who} (${p.sport}): ${slug} é de ${team.sport}`,
        );
    });
    const derbySlug = derbyPairs.get([...list].sort().join('|'));
    if (derbySlug)
      add(
        'error',
        'head-to-head-is-derby',
        p.file,
        at(p.file, ['pairs', p.index, 'slug']),
        `${who}: o par já é o clássico ${derbySlug} (use o all_time do clássico)`,
      );
    checkAllTime(who, list, p.entry.all_time, p.file, ['pairs', p.index, 'all_time']);
  }
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
    list.forEach((slug, i) => {
      const team = teams.get(slug);
      if (team && team.sport !== d.sport)
        add(
          'error',
          'derby-cross-sport',
          d.file,
          at(d.file, ['derbies', d.index, 'teams', i]),
          `clássico ${d.entry.slug} (${d.sport}): ${slug} é de ${team.sport}`,
        );
    });
    checkAllTime(`clássico ${d.entry.slug}`, list, d.entry.all_time, d.file, [
      'derbies',
      d.index,
      'all_time',
    ]);
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
      const path = [t.listKey, t.index, 'rivals', i];
      const line = at(t.file, path);
      if (r.team === t.entry.slug)
        add('error', 'self-rival', t.file, line, `${t.entry.slug} lista a si mesmo como rival`);
      const rival = teams.get(r.team);
      if (!rival) add('error', 'unknown-team', t.file, line, `${t.entry.slug}: rival inexistente ${r.team}`);
      else if (rival.sport !== t.sport)
        add(
          'error',
          'rival-cross-sport',
          t.file,
          line,
          `${t.entry.slug} (${t.sport}): rival ${r.team} é de ${rival.sport}`,
        );
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
        [t.file, t.entry.slug, [t.listKey, t.index, 'sources'], t.entry.sources] as [
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
    ...kb.headToHead.map(
      (p) =>
        [p.file, p.entry.slug, ['pairs', p.index, 'all_time', 'sources'], p.entry.all_time?.sources] as [
          string,
          string,
          (string | number)[],
          unknown,
        ],
    ),
    ...kb.derbies
      .filter((d) => d.entry.all_time)
      .map(
        (d) =>
          [d.file, d.entry.slug, ['derbies', d.index, 'all_time', 'sources'], d.entry.all_time!.sources] as [
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
    ...kb.liveries.flatMap((l) =>
      (Array.isArray(l.entry.eras) ? l.entry.eras : []).map(
        (era, i) =>
          [l.file, l.entry.slug, ['constructors', l.index, 'eras', i, 'sources'], era.sources] as [
            string,
            string,
            (string | number)[],
            unknown,
          ],
      ),
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
    const base = [t.listKey, t.index];
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

  // 10. idioma dos textos livres e traduções (i18n/<locale>.yaml)
  issues.push(...validateTexts(kb, at));

  // 11. perfil editorial dos pilotos da F1
  issues.push(...validateEditorial(kb, at));

  const sortKey = (i: Issue) => `${i.file ?? ''}|${String(i.line ?? 0).padStart(6, '0')}`;
  const sorted = issues.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return {
    errors: sorted.filter((i) => i.level === 'error'),
    warnings: sorted.filter((i) => i.level === 'warning'),
    counts: {
      files: kb.files.length,
      teams: kb.teams.length,
      derbies: kb.derbies.length,
      derbiesWithAllTime: kb.derbies.filter((d) => d.entry.all_time).length,
      headToHead: kb.headToHead.length,
      competitions: kb.competitions.length,
      copyTemplates: kb.copyTemplates.length,
      glossaryTerms: kb.glossary.length,
      texts: kb.texts.length,
      liveryEras: kb.liveries.reduce(
        (n, l) => n + (Array.isArray(l.entry.eras) ? l.entry.eras.length : 0),
        0,
      ),
      editorial: kb.editorial.length,
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

/**
 * Textos livres em vários idiomas (docs/06 §3.3): cada texto no idioma declarado (`text_locale` do arquivo
 * ou locale da tradução) e cada tradução apontando para um item existente, sem repetir o idioma-base,
 * com os mesmos fatos do original (tradução nunca acrescenta fato) e as mesmas heurísticas de letra.
 */
function validateTexts(
  kb: KnowledgeBase,
  at: (file: string, path: (string | number)[]) => number | null,
): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], code: string, file: string, line: number | null, message: string) =>
    out.push({ level, code, file, line, message });
  const checkLanguage = (
    text: unknown,
    locale: string,
    file: string,
    path: (string | number)[],
    who: string,
  ) => {
    if (typeof text !== 'string') return;
    const found = guessLanguage(text);
    if (!found || found === languageOf(locale)) return;
    const excerpt = text.length > 50 ? `${text.slice(0, 47)}…` : text;
    add(
      'warning',
      'text-language',
      file,
      at(file, path),
      `${who}: "${excerpt}" parece ${found === 'pt' ? 'português' : 'espanhol'}, mas o locale é ${locale}`,
    );
  };
  const prose = (text: unknown, file: string, path: (string | number)[], who: string) => {
    if (typeof text !== 'string') return;
    const verdict = checkProse(text);
    if (verdict) add(verdict.level, 'lyric-like', file, at(file, path), `${who}: ${verdict.reason}`);
  };

  // idioma do original
  for (const t of kb.teams)
    (t.entry.identity ?? []).forEach((s, i) =>
      checkLanguage(s, t.textLocale, t.file, [t.listKey, t.index, 'identity', i], t.entry.slug),
    );
  for (const d of kb.derbies) {
    checkLanguage(d.entry.origin, d.textLocale, d.file, ['derbies', d.index, 'origin'], d.entry.slug);
    (d.entry.trivia ?? []).forEach((s, i) =>
      checkLanguage(s, d.textLocale, d.file, ['derbies', d.index, 'trivia', i], d.entry.slug),
    );
  }

  // traduções
  const teams = new Map(kb.teams.map((t) => [t.entry.slug, t]));
  const derbies = new Map(kb.derbies.map((d) => [d.entry.slug, d]));
  const seen = new Set<string>();
  const rank = (s: unknown) => REVIEW_STATUSES.indexOf(s as (typeof REVIEW_STATUSES)[number]);
  for (const x of kb.texts) {
    const base = [x.listKey, x.index];
    const line = at(x.file, base);
    const slug = x.entry.slug;
    const key = `${x.locale}|${x.listKey}|${slug}`;
    if (seen.has(key)) add('error', 'duplicate-key', x.file, line, `tradução repetida: ${slug}`);
    seen.add(key);
    const target = x.listKey === 'teams' ? teams.get(slug) : derbies.get(slug);
    if (!target) {
      add(
        'error',
        'i18n-unknown-slug',
        x.file,
        line,
        `${x.listKey === 'teams' ? 'time' : 'clássico'} inexistente: ${slug}`,
      );
      continue;
    }
    // texto na voz do país (es-AR) já serve todo mercado em espanhol: um `es` neutro por cima o apagaria
    if (target.textLocale === x.locale || target.textLocale.split('-')[0] === x.locale)
      add(
        'error',
        'i18n-redundant',
        x.file,
        line,
        `${slug}: o texto original já está em ${target.textLocale} (${target.file}) — edite lá`,
      );
    if (rank(x.entry.review_status) > rank(target.entry.review_status))
      add(
        'warning',
        'i18n-review',
        x.file,
        at(x.file, [...base, 'review_status']),
        `${slug}: tradução ${x.entry.review_status} com original ${target.entry.review_status} — revise o original primeiro`,
      );
    const drift = (field: string, message: string) =>
      add('warning', 'i18n-drift', x.file, at(x.file, [...base, field]), `${slug}: ${message}`);
    if (x.listKey === 'teams') {
      const e = x.entry;
      const t = (target as LocatedTeam).entry;
      const original = t.identity ?? [];
      if (e.identity && e.identity.length !== original.length)
        drift(
          'identity',
          `${e.identity.length} fato(s) traduzido(s) para ${original.length} no original (traduza os mesmos fatos, na mesma ordem)`,
        );
      if (e.mascot && !t.mascot) drift('mascot', 'mascote traduzido sem mascote no original');
      (e.identity ?? []).forEach((s, i) => {
        prose(s, x.file, [...base, 'identity', i], slug);
        checkLanguage(s, x.locale, x.file, [...base, 'identity', i], slug);
      });
    } else {
      const e = x.entry;
      const d = (target as LocatedDerby).entry;
      if (e.origin && !d.origin) drift('origin', 'origin traduzido sem origin no original');
      if (e.trivia && e.trivia.length !== (d.trivia ?? []).length)
        drift(
          'trivia',
          `${e.trivia.length} curiosidade(s) traduzida(s) para ${(d.trivia ?? []).length} no original`,
        );
      prose(e.origin, x.file, [...base, 'origin'], slug);
      checkLanguage(e.origin, x.locale, x.file, [...base, 'origin'], slug);
      (e.trivia ?? []).forEach((s, i) => {
        prose(s, x.file, [...base, 'trivia', i], slug);
        checkLanguage(s, x.locale, x.file, [...base, 'trivia', i], slug);
      });
    }
  }
  return out;
}

/** Formata o relatório para terminal (pt-BR). */
export function formatReport(report: ValidationReport): string {
  const line = (i: Issue) =>
    `  ${i.level === 'error' ? '✗' : '!'} ${i.file ?? '-'}${i.line ? `:${i.line}` : ''} [${i.code}] ${i.message}`;
  const c = report.counts;
  return [
    `Base semântica: ${c.files} arquivos · ${c.teams} times/seleções · ${c.derbies} clássicos (${c.derbiesWithAllTime} com histórico geral) · ${c.headToHead} outros confrontos · ${c.competitions} competições · ${c.copyTemplates} templates de copy · ${c.glossaryTerms} termos de glossário · ${c.texts} traduções · ${c.liveryEras} pinturas da F1 · ${c.editorial} perfis editoriais da F1`,
    ...(report.errors.length ? [`Erros (${report.errors.length}):`, ...report.errors.map(line)] : []),
    ...(report.warnings.length ? [`Avisos (${report.warnings.length}):`, ...report.warnings.map(line)] : []),
    report.errors.length
      ? `✗ ${report.errors.length} erro(s) — corrija antes do merge.`
      : `✓ Nenhum erro${report.warnings.length ? ` (${report.warnings.length} aviso(s))` : ''}.`,
  ].join('\n');
}

/**
 * Perfil editorial (formula-1/editorial/<locale>.yaml): um por piloto e idioma, slug = `f1-<id do F1DB>`, o nível
 * diz o que o perfil traz (`regular` só a bio), a tradução precisa do original em pt-BR, e os textos no idioma do
 * arquivo e sem cara de letra de música. Fonte por item e o resto do formato ficam no schema.
 */
function validateEditorial(
  kb: KnowledgeBase,
  at: (file: string, path: (string | number)[]) => number | null,
): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], code: string, file: string, line: number | null, message: string) =>
    out.push({ level, code, file, line, message });
  const originals = new Set(kb.editorial.filter((e) => e.locale === 'pt-BR').map((e) => e.entry.slug));
  const seen = new Set<string>();
  for (const e of kb.editorial) {
    const base = ['drivers', e.index];
    const { slug, f1db, tier } = e.entry;
    const key = `${e.locale}|${slug}`;
    if (seen.has(key))
      add('error', 'duplicate-slug', e.file, at(e.file, base), `perfil editorial repetido: ${slug}`);
    seen.add(key);
    if (f1db?.id && slug !== driverSlug(f1db.id))
      add(
        'error',
        'editorial-slug',
        e.file,
        at(e.file, [...base, 'slug']),
        `${slug}: o slug deve ser ${driverSlug(f1db.id)}`,
      );
    const extras = (['style', 'strengths', 'moments', 'rivalries'] as const).filter(
      (k) => e.entry[k] !== undefined,
    );
    if (tier === 'regular' && extras.length)
      add(
        'error',
        'editorial-tier',
        e.file,
        at(e.file, base),
        `${slug}: nível regular só traz a bio (sobram ${extras.join(', ')})`,
      );
    if (tier === 'legend' && (!e.entry.style || !e.entry.moments?.length))
      add('warning', 'editorial-tier', e.file, at(e.file, base), `${slug}: lenda sem estilo ou sem momentos`);
    if (e.locale !== 'pt-BR' && !originals.has(slug))
      add(
        'error',
        'editorial-original',
        e.file,
        at(e.file, base),
        `${slug}: tradução sem o original em pt-BR`,
      );

    const texts: [unknown, (string | number)[]][] = [
      [e.entry.bio?.text, ['bio', 'text']],
      [e.entry.style?.text, ['style', 'text']],
      ...(e.entry.strengths ?? []).map(
        (s, i) => [s.text, ['strengths', i, 'text']] as [unknown, (string | number)[]],
      ),
      ...(e.entry.moments ?? []).map(
        (m, i) => [m.text, ['moments', i, 'text']] as [unknown, (string | number)[]],
      ),
      ...(e.entry.rivalries ?? []).map(
        (r, i) => [r.text, ['rivalries', i, 'text']] as [unknown, (string | number)[]],
      ),
    ];
    for (const [text, path] of texts) {
      if (typeof text !== 'string') continue;
      const where = at(e.file, [...base, ...path]);
      const verdict = checkProse(text);
      if (verdict) add(verdict.level, 'lyric-like', e.file, where, `${slug}: ${verdict.reason}`);
      const found = guessLanguage(text);
      if (found && found !== languageOf(e.locale)) {
        const excerpt = text.length > 50 ? `${text.slice(0, 47)}…` : text;
        add('warning', 'text-language', e.file, where, `${slug}: "${excerpt}" não parece ${e.locale}`);
      }
    }
  }
  return out;
}
