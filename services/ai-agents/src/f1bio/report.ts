import type { BioChanges } from './apply.js';
import type { BioProposal } from './propose.js';

/** Relatório legível das propostas (e do que foi aplicado no YAML, quando há). */
export function bioReport(proposals: BioProposal[], changes: BioChanges | null): string {
  return [
    '# Biografias de pilotos (F1) — propostas `draft`',
    '',
    ...proposals.map((p) =>
      [
        `## ${p.facts.name} (\`${p.facts.f1dbId}\`) — ${p.status}`,
        ...p.identity.map((s) => `- ${s.text} — ${s.source}`),
        ...p.dropped.map((d) => `- ~~${d.text}~~ (${d.reason})`),
        ...p.reasons.map((r) => `> ${r}`),
      ].join('\n'),
    ),
    ...(changes
      ? [
          '',
          `Aplicadas: ${changes.applied.join(', ') || '—'}`,
          ...changes.skipped.map((s) => `Não aplicada: ${s.f1dbId} — ${s.reason}`),
        ]
      : []),
  ].join('\n');
}
