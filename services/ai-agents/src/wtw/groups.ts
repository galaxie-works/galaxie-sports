/**
 * Agrupamento do onde assistir: rodada (competição × rodada do fornecedor, ou data) e pacotes de
 * mercados que cabem numa única busca (allowlist ≤ 100 domínios).
 */
import { domainHost, MAX_ALLOWED_DOMAINS, type CountryDirectory } from '@galaxie/where-to-watch';

/** Rodada do jogo: rótulo do fornecedor ou, sem ele, a data UTC do início. */
export function roundKeyOf(round: string | null | undefined, startsAt: Date): string {
  return round?.trim() || `data:${startsAt.toISOString().slice(0, 10)}`;
}

/** Grupo da alocação: uma chamada por (competição, rodada) para todos os mercados. */
export function groupKeyOf(competition: string | null | undefined, round: string): string {
  return `${competition ?? 'sem-competicao'}|${round}`;
}

/**
 * Allowlist conjunta de vários países: primeiro organizadores e domínios das emissoras indicadas
 * (ou de todas), depois a imprensa de cada país em rodízio, até `max`.
 */
export function jointAllowedDomains(
  directories: CountryDirectory[],
  opts: { broadcasterIds?: Map<string, string[]>; max?: number } = {},
): string[] {
  const max = opts.max ?? MAX_ALLOWED_DOMAINS;
  const out = new Set<string>();
  const add = (d: string) => {
    if (out.size < max) out.add(domainHost(d));
  };
  for (const dir of directories) dir.sources.organizers.forEach(add);
  for (const dir of directories) {
    const ids = opts.broadcasterIds?.get(dir.country);
    for (const b of dir.broadcasters) if (!ids || ids.includes(b.id)) b.domains.forEach(add);
  }
  const press = directories.map((d) => [...d.sources.press]);
  for (let i = 0; press.some((p) => i < p.length); i++) for (const p of press) if (p[i]) add(p[i]!);
  return [...out];
}

/** Domínios essenciais de um país (organizadores + emissoras). */
const coreDomains = (dir: CountryDirectory) =>
  new Set(
    [...dir.sources.organizers, ...dir.broadcasters.flatMap((b) => b.domains)].map((d) => domainHost(d)),
  );

/**
 * Empacota mercados em chamadas: cabe numa chamada enquanto a união dos domínios essenciais
 * (organizadores + emissoras) couber na allowlist. Hoje os 8 mercados cabem numa só.
 */
export function packMarkets(
  directories: CountryDirectory[],
  max = MAX_ALLOWED_DOMAINS,
): CountryDirectory[][] {
  const chunks: { dirs: CountryDirectory[]; domains: Set<string> }[] = [];
  for (const dir of directories) {
    const core = coreDomains(dir);
    const fit = chunks.find((c) => new Set([...c.domains, ...core]).size <= max);
    if (fit) {
      fit.dirs.push(dir);
      core.forEach((d) => fit.domains.add(d));
    } else chunks.push({ dirs: [dir], domains: core });
  }
  return chunks.map((c) => c.dirs);
}
