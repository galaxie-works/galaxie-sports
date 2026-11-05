import { ALL_RULES, LAYER_TITLES } from './rules.mjs';

/** Id seguro para o Mermaid: `packages/where-to-watch` → `packages_where_to_watch`. */
const nodeId = (dir) => dir.replace(/[^a-z0-9]/gi, '_');

/** Rótulo do nó: apps e serviços pela pasta, pacotes pelo nome sem o escopo. */
const nodeLabel = (unit) => (unit.group === 'packages' ? unit.name.replace(/^@galaxie\//, '') : unit.dir);

/**
 * O mapa de quem importa quem: uma caixa por camada, uma seta por par de pacotes em que o código de produção (fora de
 * testes) de um importa o outro. Sai do mesmo cálculo do `pnpm lint:deps`.
 * @param {{ dir: string, name: string, kind: string|null, group: string }[]} units
 * @param {Map<string, Set<string>>} edges
 */
export function renderMap(units, edges) {
  const lines = ['```mermaid', 'flowchart TB'];
  for (const [kind, title] of Object.entries(LAYER_TITLES)) {
    const members = units.filter((u) => u.kind === kind);
    if (!members.length) continue;
    lines.push(`  subgraph ${title}`);
    for (const u of members) lines.push(`    ${nodeId(u.dir)}[${nodeLabel(u)}]`);
    lines.push('  end');
  }
  lines.push('');
  const known = new Set(units.filter((u) => u.kind).map((u) => u.dir));
  for (const unit of units) {
    const targets = [...(edges.get(unit.dir) ?? [])].filter((d) => known.has(d)).sort();
    if (targets.length) lines.push(`  ${nodeId(unit.dir)} --> ${targets.map(nodeId).join(' & ')}`);
  }
  lines.push('```');
  return lines.join('\n');
}

/** A tabela das regras cobradas pelo CI. */
export function renderRulesTable() {
  const rows = ALL_RULES.map((r) => `| \`${r.id}\` | ${r.summary} | ${r.why} |`);
  return ['| Regra | O que exige | Por quê |', '|---|---|---|', ...rows].join('\n');
}

/**
 * Troca o conteúdo entre `<!-- nome:start ... -->` e `<!-- nome:end -->`. Falta de marcador falha em vez de passar
 * calado (o documento perderia o mapa sem ninguém notar).
 */
export function updateBlocks(text, blocks) {
  let out = text;
  for (const [name, content] of Object.entries(blocks)) {
    const pattern = new RegExp(`(<!-- ${name}:start[^>]*-->)[\\s\\S]*?(<!-- ${name}:end -->)`);
    if (!pattern.test(out)) {
      throw new Error(`docs/15: faltam os marcadores <!-- ${name}:start --> e <!-- ${name}:end -->`);
    }
    out = out.replace(pattern, (_all, open, close) => `${open}\n${content}\n${close}`);
  }
  return out;
}
