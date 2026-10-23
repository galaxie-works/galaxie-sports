/**
 * Manifesto versionado de um acervo customizado de logos (config/assets/acervo/<id>.yaml): de onde veio
 * o pacote (autor, licença, revisão) e, para cada logo, o arquivo, o país, o nome, o hash e o time ou a
 * competição a que ele foi ligado. Os binários nunca entram no git; o manifesto é o rastro de cada asset
 * e o lugar da curadoria (um `participant_id` escrito à mão vira `match: manual` e sobrevive a novas
 * varreduras). Ver docs/runbooks/acervo-de-logos.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

export const ACERVO_SCHEMA_VERSION = 1;

/** team → core.participant (futebol); competition → core.competition (futebol). */
export type AcervoKind = 'team' | 'competition';

/**
 * - auto: o mapeamento por país + nome achou um único par com confiança alta;
 * - manual: curadoria (id escrito à mão no manifesto); nunca é sobrescrito;
 * - rejected: curadoria disse que não tem par; nunca é remapeado;
 * - ambiguous: candidatos próximos demais — fica sem vínculo até a curadoria escolher;
 * - unmatched: nenhum candidato razoável no país.
 */
export const MATCH_STATUSES = ['auto', 'manual', 'rejected', 'ambiguous', 'unmatched'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface AcervoCandidate {
  id: string;
  name: string;
  confidence: number;
}

export interface AcervoLogo {
  /** Caminho sem extensão no pacote (teams/br/palmeiras); identifica o logo entre as revisões. */
  key: string;
  kind: AcervoKind;
  /** Código do país (ISO 3166-1 alfa-2 ou extensão da api-sports, ex.: GB-ENG); WORLD para torneios internacionais. */
  country: string;
  name: string;
  /** Arquivo servido (SVG de preferência; senão o maior PNG), relativo à pasta do pacote. */
  file: string;
  /** PNG do mesmo logo, quando houver: fonte da paleta de cores (mais fiel que ler as cores do SVG). */
  palette_file?: string | undefined;
  sha256: string;
  /** Id em core.participant (team) ou core.competition (competition); null = sem vínculo. */
  target_id: string | null;
  target_name?: string | undefined;
  match: MatchStatus;
  confidence?: number | undefined;
  /** Só em `ambiguous`: os candidatos, para a curadoria escolher. */
  candidates?: AcervoCandidate[] | undefined;
}

export interface AcervoInfo {
  /** Identificador curto ([a-z0-9-]); vai para core.asset.acervo e para a storage_key (acervo/<id>/...). */
  id: string;
  name: string;
  /** Autor ou fornecedor do pacote — o crédito publicado nas docs. */
  author: string;
  /** Licença ou contrato que autoriza o uso. */
  license: string;
  url?: string | undefined;
  /** Versão do pacote (tag, data ou commit de origem). */
  revision: string;
}

export interface AcervoManifest {
  schema_version: number;
  acervo: AcervoInfo;
  generated_at: string;
  logos: AcervoLogo[];
}

export const ACERVO_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateAcervoInfo(info: Partial<AcervoInfo> | undefined): AcervoInfo {
  if (!info?.id || !ACERVO_ID_RE.test(info.id)) throw new Error(`id de acervo inválido: ${info?.id}`);
  for (const k of ['name', 'author', 'license', 'revision'] as const)
    if (!info[k]?.toString().trim())
      throw new Error(`acervo ${info.id}: falta "${k}" (acervo.yaml do pacote)`);
  return {
    id: info.id,
    name: String(info.name),
    author: String(info.author),
    license: String(info.license),
    ...(info.url ? { url: String(info.url) } : {}),
    revision: String(info.revision),
  };
}

export function readManifest(path: string): AcervoManifest {
  const doc = parse(readFileSync(path, 'utf8')) as AcervoManifest | null;
  if (!doc || doc.schema_version !== ACERVO_SCHEMA_VERSION) throw new Error(`manifesto inválido: ${path}`);
  doc.acervo = validateAcervoInfo(doc.acervo);
  doc.logos ??= [];
  for (const l of doc.logos) {
    if (!MATCH_STATUSES.includes(l.match)) throw new Error(`${path}: match inválido em ${l.key}: ${l.match}`);
    l.target_id ??= null;
  }
  return doc;
}

/** Grava o manifesto em ordem estável (país, tipo, chave): diffs pequenos entre revisões. */
export function writeManifest(path: string, manifest: AcervoManifest): void {
  const logos = [...manifest.logos]
    .sort(
      (a, b) =>
        a.country.localeCompare(b.country) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key),
    )
    .map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
  const header =
    '# Manifesto do acervo customizado de logos — gerado por `assets:acervo --mapear`.\n' +
    '# Curadoria: escreva target_id e match: manual (ou match: rejected) — a próxima varredura mantém.\n';
  writeFileSync(path, header + stringify({ ...manifest, logos }, { lineWidth: 0 }), 'utf8');
}
