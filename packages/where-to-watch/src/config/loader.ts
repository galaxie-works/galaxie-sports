import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  ACCESS_MODELS,
  BROADCAST_MEDIA,
  RIGHTS_DISTRIBUTIONS,
  type AccessModel,
  type BroadcastMedium,
  type RightsDistribution,
} from '@galaxie/db';
import { normalizeName } from '../normalize.js';
import { Blocklist, WtwConfig } from './directory.js';
import {
  WTW_COUNTRIES,
  type BlockEntry,
  type BroadcasterEntry,
  type CountryConfig,
  type LogoEntry,
  type RightsEntry,
  type RightsRule,
  type SourceDomains,
  type WtwCountry,
} from './types.js';

export class WtwConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WtwConfigError';
  }
}

/** Raiz `config/` do monorepo (mesma profundidade em src/ e dist/). */
export function defaultConfigRoot(): string {
  // WTW_CONFIG_DIR: imagens Docker, onde o pacote não fica na árvore do monorepo
  return process.env.WTW_CONFIG_DIR ?? fileURLToPath(new URL('../../../../config/', import.meta.url));
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function strList(v: unknown, where: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim()))
    throw new WtwConfigError(`${where}: esperava uma lista de textos.`);
  return (v as string[]).map((s) => s.trim());
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new WtwConfigError(`${where}: texto obrigatório.`);
  return v.trim();
}

/** Datas do YAML podem chegar como string ou Date. */
function day(v: unknown, where: string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new WtwConfigError(`${where}: data inválida (use AAAA-MM-DD).`);
}

function parseSources(raw: unknown, where: string): SourceDomains {
  const r = isObj(raw) ? raw : {};
  return {
    organizers: strList(r.organizers, `${where}.organizers`),
    press: strList(r.press, `${where}.press`),
    aggregators: strList(r.aggregators, `${where}.aggregators`),
  };
}

function parseBroadcaster(raw: unknown, where: string): BroadcasterEntry {
  if (!isObj(raw)) throw new WtwConfigError(`${where}: entrada inválida.`);
  const id = str(raw.id, `${where}.id`);
  if (!/^[a-z0-9_]+$/.test(id)) throw new WtwConfigError(`${where}.id: use [a-z0-9_] (recebido "${id}").`);
  const medium = str(raw.medium, `${where}.medium`);
  if (!(BROADCAST_MEDIA as readonly string[]).includes(medium))
    throw new WtwConfigError(`${where}.medium inválido: ${medium} (use ${BROADCAST_MEDIA.join(', ')}).`);
  const access = str(raw.access_model, `${where}.access_model`);
  if (!(ACCESS_MODELS as readonly string[]).includes(access))
    throw new WtwConfigError(`${where}.access_model inválido: ${access}.`);
  const domains = strList(raw.domains, `${where}.domains`);
  if (!domains.length) throw new WtwConfigError(`${where}.domains: ao menos um domínio oficial.`);
  const variants = raw.regional_variants ?? [];
  if (!Array.isArray(variants)) throw new WtwConfigError(`${where}.regional_variants: esperava lista.`);
  return {
    id,
    name: str(raw.name, `${where}.name`),
    aliases: strList(raw.aliases, `${where}.aliases`),
    channels: strList(raw.channels, `${where}.channels`),
    medium: medium as BroadcastMedium,
    accessModel: access as AccessModel,
    group: typeof raw.group === 'string' && raw.group.trim() ? raw.group.trim() : null,
    domains,
    regionalVariants: variants.map((v, i) => {
      if (!isObj(v)) throw new WtwConfigError(`${where}.regional_variants[${i}] inválida.`);
      return {
        name: str(v.name, `${where}.regional_variants[${i}].name`),
        region: str(v.region, `${where}.regional_variants[${i}].region`).toUpperCase(),
      };
    }),
  };
}

function parseRule(raw: unknown, where: string): RightsRule {
  if (!isObj(raw)) throw new WtwConfigError(`${where}: regra inválida.`);
  const rule: RightsRule = {
    holders: strList(raw.holders, `${where}.holders`),
    homeTeams: strList(raw.home_teams, `${where}.home_teams`),
    teams: strList(raw.teams, `${where}.teams`),
    rounds: strList(raw.rounds, `${where}.rounds`),
  };
  if (!rule.holders.length) throw new WtwConfigError(`${where}.holders: ao menos um detentor.`);
  if (!rule.homeTeams.length && !rule.teams.length && !rule.rounds.length)
    throw new WtwConfigError(`${where}: informe home_teams, teams ou rounds (sem filtro, use all_matches).`);
  return rule;
}

function parseRights(raw: unknown, where: string): RightsEntry {
  if (!isObj(raw)) throw new WtwConfigError(`${where}: entrada inválida.`);
  const season = Number(raw.season);
  if (!Number.isInteger(season)) throw new WtwConfigError(`${where}.season: ano inteiro.`);
  const validFrom = day(raw.valid_from, `${where}.valid_from`);
  const validTo = day(raw.valid_to, `${where}.valid_to`);
  if (validTo < validFrom) throw new WtwConfigError(`${where}: valid_to anterior a valid_from.`);
  const sources = strList(raw.sources, `${where}.sources`);
  if (!sources.length) throw new WtwConfigError(`${where}.sources: cite ao menos uma fonte oficial.`);
  const distribution = String(raw.distribution ?? 'to_confirm');
  if (!(RIGHTS_DISTRIBUTIONS as readonly string[]).includes(distribution))
    throw new WtwConfigError(
      `${where}.distribution inválida: ${distribution} (use ${RIGHTS_DISTRIBUTIONS.join(', ')}).`,
    );
  const holders = strList(raw.holders, `${where}.holders`);
  const allMatches = strList(raw.all_matches, `${where}.all_matches`);
  if (raw.rules !== undefined && raw.rules !== null && !Array.isArray(raw.rules))
    throw new WtwConfigError(`${where}.rules: esperava lista.`);
  const rules = ((raw.rules as unknown[] | null | undefined) ?? []).map((r, i) =>
    parseRule(r, `${where}.rules[${i}]`),
  );
  const notHolder = [...allMatches, ...rules.flatMap((r) => r.holders)].find((h) => !holders.includes(h));
  if (notHolder)
    throw new WtwConfigError(`${where}: "${notHolder}" em all_matches/rules precisa estar em holders.`);
  if ((distribution === 'exclusive' || distribution === 'all_matches') && !holders.length)
    throw new WtwConfigError(`${where}: distribution ${distribution} exige holders.`);
  return {
    competition: str(raw.competition, `${where}.competition`),
    season,
    validFrom,
    validTo,
    perRoundSelection: raw.per_round_selection === true,
    holders,
    uncertainHolders: strList(raw.uncertain_holders, `${where}.uncertain_holders`),
    distribution: distribution as RightsDistribution,
    allMatches,
    rules,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : null,
    sources,
    origin: 'curated',
    confidence: null,
  };
}

/**
 * `exclusive` com mais de um detentor só vale se forem plataformas do mesmo grupo de mídia
 * (ex.: canal pago + streaming do mesmo dono).
 */
function assertExclusive(entry: RightsEntry, broadcasters: BroadcasterEntry[], where: string): void {
  if (entry.distribution !== 'exclusive' || entry.holders.length < 2) return;
  const groups = new Set(entry.holders.map((h) => broadcasters.find((b) => b.id === h)?.group ?? h));
  if (groups.size > 1)
    throw new WtwConfigError(
      `${where}: distribution exclusive com detentores de grupos diferentes (use all_matches ou split).`,
    );
}

/** `_logos.yaml`: `logos: [{ id, url, source_page, license }]` — só logos com origem e licença. */
export function parseLogos(raw: Raw | null, knownIds: Set<string>): Map<string, LogoEntry> {
  const out = new Map<string, LogoEntry>();
  if (!raw) return out;
  if (!Array.isArray(raw.logos)) throw new WtwConfigError('_logos.yaml: lista "logos" obrigatória.');
  raw.logos.forEach((l, i) => {
    const where = `_logos.yaml[${i}]`;
    if (!isObj(l)) throw new WtwConfigError(`${where}: entrada inválida.`);
    const id = str(l.id, `${where}.id`);
    if (!knownIds.has(id)) throw new WtwConfigError(`${where}: emissora "${id}" não existe nos dicionários.`);
    if (out.has(id)) throw new WtwConfigError(`${where}: logo duplicado para ${id}.`);
    const url = str(l.url, `${where}.url`);
    if (!url.startsWith('https://')) throw new WtwConfigError(`${where}.url: use https.`);
    out.set(id, {
      id,
      url,
      sourcePage: str(l.source_page, `${where}.source_page`),
      license: str(l.license, `${where}.license`),
    });
  });
  return out;
}

function readYaml(path: string): Raw {
  const raw = parse(readFileSync(path, 'utf8')) as unknown;
  if (!isObj(raw)) throw new WtwConfigError(`${path}: YAML vazio ou inválido.`);
  return raw;
}

/** Valida e monta a configuração de um país (dicionário + tabela de direitos). */
export function parseCountryConfig(
  country: WtwCountry,
  broadcastersRaw: Raw,
  rightsRaw: Raw | null,
  common: SourceDomains,
): CountryConfig {
  const where = `broadcasters/${country.toLowerCase()}.yaml`;
  if (broadcastersRaw.country !== country)
    throw new WtwConfigError(`${where}: country deve ser ${country} (igual ao nome do arquivo).`);
  if (!Array.isArray(broadcastersRaw.broadcasters))
    throw new WtwConfigError(`${where}: lista "broadcasters" obrigatória.`);
  const broadcasters = broadcastersRaw.broadcasters.map((b, i) => parseBroadcaster(b, `${where}[${i}]`));

  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const b of broadcasters) {
    if (ids.has(b.id)) throw new WtwConfigError(`${where}: id duplicado ${b.id}.`);
    ids.add(b.id);
    for (const n of [b.name, ...b.aliases, ...b.channels, ...b.regionalVariants.map((v) => v.name)]) {
      const key = normalizeName(n);
      const owner = names.get(key);
      if (owner && owner !== b.id)
        throw new WtwConfigError(`${where}: o nome "${n}" aparece em ${owner} e ${b.id} (ambíguo).`);
      names.set(key, b.id);
    }
  }

  const own = parseSources(broadcastersRaw.sources, `${where}.sources`);
  const sources: SourceDomains = {
    organizers: [...new Set([...own.organizers, ...common.organizers])],
    press: [...new Set([...own.press, ...common.press])],
    aggregators: [...new Set([...own.aggregators, ...common.aggregators])],
  };

  const rights: RightsEntry[] = [];
  if (rightsRaw) {
    const rw = `broadcast-rights/${country.toLowerCase()}.yaml`;
    if (rightsRaw.country !== country) throw new WtwConfigError(`${rw}: country deve ser ${country}.`);
    if (!Array.isArray(rightsRaw.rights)) throw new WtwConfigError(`${rw}: lista "rights" obrigatória.`);
    rightsRaw.rights.forEach((r, i) => {
      const entry = parseRights(r, `${rw}[${i}]`);
      for (const id of [...entry.holders, ...entry.uncertainHolders])
        if (!ids.has(id))
          throw new WtwConfigError(`${rw}[${i}]: detentor "${id}" não existe no dicionário ${where}.`);
      for (const rule of entry.rules)
        for (const id of rule.holders)
          if (!ids.has(id)) throw new WtwConfigError(`${rw}[${i}]: detentor "${id}" não existe.`);
      assertExclusive(entry, broadcasters, `${rw}[${i}]`);
      const overlap = rights.find(
        (o) =>
          o.competition === entry.competition && o.validFrom <= entry.validTo && entry.validFrom <= o.validTo,
      );
      if (overlap)
        throw new WtwConfigError(`${rw}[${i}]: período sobreposto para ${entry.competition}.`);
      rights.push(entry);
    });
  }

  return {
    country,
    language: typeof broadcastersRaw.language === 'string' ? broadcastersRaw.language : 'es',
    broadcasters,
    sources,
    rights,
  };
}

function parseBlockEntries(raw: unknown, where: string): BlockEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WtwConfigError(`${where}: blocklist deve ser uma lista.`);
  return raw.map((e, i) => {
    if (typeof e === 'string') return { name: e.trim(), aliases: [], domains: [] };
    if (!isObj(e)) throw new WtwConfigError(`${where}[${i}]: entrada inválida.`);
    return {
      name: typeof e.name === 'string' ? e.name.trim() : null,
      aliases: strList(e.aliases, `${where}[${i}].aliases`),
      domains: strList(e.domains, `${where}[${i}].domains`),
    };
  });
}

/** `WTW_BLOCKLIST`: nomes e domínios separados por vírgula (texto com ponto e sem espaço = domínio). */
export function parseBlocklistEnv(value: string | undefined): BlockEntry[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) =>
      /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v)
        ? { name: null, aliases: [], domains: [v] }
        : { name: v, aliases: [], domains: [] },
    );
}

export interface LoadWtwConfigOptions {
  /** Raiz `config/` (padrão: a do monorepo). */
  root?: string;
  /** Variáveis de ambiente (WTW_BLOCKLIST_FILE, WTW_BLOCKLIST). Padrão: process.env. */
  env?: Record<string, string | undefined>;
  /** Entradas extras de blocklist (testes). */
  extraBlocklist?: BlockEntry[];
}

/** Carrega dicionários, tabelas de direitos e política dos 8 mercados. */
export function loadWtwConfig(options: LoadWtwConfigOptions = {}): WtwConfig {
  const root = options.root ?? defaultConfigRoot();
  const env = options.env ?? process.env;
  const bDir = join(root, 'broadcasters');
  const rDir = join(root, 'broadcast-rights');

  const commonPath = join(bDir, '_common.yaml');
  const common = existsSync(commonPath)
    ? parseSources(readYaml(commonPath).sources, '_common.yaml')
    : { organizers: [], press: [], aggregators: [] };

  const countries = WTW_COUNTRIES.map((c) => {
    const bPath = join(bDir, `${c.toLowerCase()}.yaml`);
    if (!existsSync(bPath)) throw new WtwConfigError(`Dicionário ausente: ${bPath}`);
    const rPath = join(rDir, `${c.toLowerCase()}.yaml`);
    return parseCountryConfig(c, readYaml(bPath), existsSync(rPath) ? readYaml(rPath) : null, common);
  });

  const policyPath = join(bDir, '_policy.yaml');
  const block: BlockEntry[] = existsSync(policyPath)
    ? parseBlockEntries(readYaml(policyPath).blocklist, '_policy.yaml')
    : [];
  const externalFile = env.WTW_BLOCKLIST_FILE;
  if (externalFile) {
    if (!existsSync(externalFile)) throw new WtwConfigError(`WTW_BLOCKLIST_FILE não encontrado: ${externalFile}`);
    block.push(...parseBlockEntries(readYaml(externalFile).blocklist, 'WTW_BLOCKLIST_FILE'));
  }
  block.push(...parseBlocklistEnv(env.WTW_BLOCKLIST), ...(options.extraBlocklist ?? []));

  const logosPath = join(bDir, '_logos.yaml');
  const knownIds = new Set(countries.flatMap((c) => c.broadcasters.map((b) => b.id)));
  const logos = parseLogos(existsSync(logosPath) ? readYaml(logosPath) : null, knownIds);

  return new WtwConfig(countries, new Blocklist(block), logos);
}
