/** Relatório em markdown de uma execução (o `--md` do `quality:run`, para anexar a um PR ou nota). */
import type { RuleResultRow } from './engine.js';
import { QUALITY_RULES } from './rules/index.js';

const esc = (v: string | null | undefined) => (v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdownReport(rows: readonly RuleResultRow[], when: Date): string {
  const desc = new Map(QUALITY_RULES.map((r) => [r.id, r.description['pt-BR']]));
  const lines = [
    '# Qualidade dos dados',
    '',
    `Gerado em ${when.toISOString()} · ${new Set(rows.map((r) => r.ruleId)).size} regras · ${rows.filter((r) => r.status === 'fail').length} com falha`,
    '',
    '## Placar por regra e esporte',
    '',
    '| Regra | Esporte | Severidade | Status | Errados | Conferidos | Observação |',
    '|---|---|---|---|---:|---:|---|',
    ...rows.map(
      (r) =>
        `| \`${r.ruleId}\` ${esc(desc.get(r.ruleId))} | ${r.sport} | ${r.severity} | ${r.status} | ${r.failed} | ${r.checked} | ${esc(r.detail)} |`,
    ),
    '',
    '## Falhas (até 20 por regra e esporte)',
    '',
  ];
  for (const r of rows.filter((x) => x.failures.length)) {
    lines.push(
      `### \`${r.ruleId}\` · ${r.sport} (${r.failed})`,
      '',
      '| Item | Atual | Esperado |',
      '|---|---|---|',
    );
    for (const f of r.failures.slice(0, 20))
      lines.push(`| ${esc(f.label)} | ${esc(f.current)} | ${esc(f.expected)} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
