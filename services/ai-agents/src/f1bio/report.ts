import type { BioChanges } from './apply.js';
import type { ProfileChanges } from './apply-profile.js';
import type { ProfileProposal } from './profile.js';
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

/** Relatório legível dos perfis editoriais propostos (e do que foi aplicado no YAML, quando há). */
export function profileReport(proposals: ProfileProposal[], changes: ProfileChanges | null): string {
  const item = (label: string, text: string, source: string | string[]) =>
    `- **${label}** ${text} — ${Array.isArray(source) ? source.join(', ') : source}`;
  return [
    '# Perfil editorial de pilotos (F1) — propostas `draft`',
    '',
    ...proposals.map((p) => {
      const e = p.entries['pt-BR'];
      return [
        `## ${p.name} (\`${p.f1dbId}\`, ${p.tier}) — ${p.status}${p.entries.es ? ' · es ✓' : ''}`,
        ...(e
          ? [
              item('bio', e.bio.text.replace(/\n+/g, ' '), e.bio.sources),
              ...(e.style ? [item(`estilo (${e.style.kind})`, e.style.text, e.style.sources)] : []),
              ...(e.strengths ?? []).map((s) => item(`forte (${s.key})`, s.text, s.source)),
              ...(e.moments ?? []).map((m) =>
                item(`${m.year} ${m.race}${m.wet ? ' 🌧' : ''}`, m.text, m.source),
              ),
              ...(e.rivalries ?? []).map((r) => item(`× ${r.driver.name}`, r.text, r.source)),
            ]
          : []),
        ...p.dropped.map((d) => `- ~~${d.locale} ${d.field}: ${d.text.slice(0, 120)}~~ (${d.reason})`),
        ...p.reasons.map((r) => `> ${r}`),
      ].join('\n');
    }),
    ...(changes
      ? [
          '',
          `Aplicados: ${changes.applied.join(', ') || '—'}`,
          ...changes.skipped.map((s) => `Não aplicado: ${s.locale}:${s.f1dbId} — ${s.reason}`),
        ]
      : []),
  ].join('\n');
}
