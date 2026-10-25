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
  const item = (label: string, text: string, source: string | string[] | undefined) =>
    `- **${label}** ${text} — ${Array.isArray(source) ? source.join(', ') || 'sem fonte' : (source ?? 'sem fonte')}`;
  /** O trecho que o achado aponta, no texto do campo. */
  const excerpt = (
    e: NonNullable<ProfileProposal['entries']['pt-BR']>,
    field: string,
    start: number,
    end: number,
  ) => {
    const m = /^(bio|style|strengths|moments|rivalries)(?:\[(\d+)\])?(?:\.(sources?)(?:\[(\d+)\])?)?$/.exec(
      field,
    );
    if (!m) return '';
    const [, part, index, src, srcIndex] = m;
    const node =
      part === 'bio' ? e.bio : part === 'style' ? e.style : (e[part as 'strengths'] ?? [])[Number(index)];
    if (!node) return '';
    const text = src
      ? (((node as { sources?: string[] }).sources ?? [])[Number(srcIndex)] ??
        (node as { source?: string }).source ??
        '')
      : node.text;
    return text.slice(start, end).replace(/\s+/g, ' ');
  };
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
                item(`${m.year ?? '?'} ${m.race}${m.wet ? ' 🌧' : ''}`, m.text, m.source),
              ),
              ...(e.rivalries ?? []).map((r) => item(`× ${r.driver.name}`, r.text, r.source)),
            ]
          : []),
        ...(['pt-BR', 'es'] as const).flatMap((l) => {
          const entry = p.entries[l];
          return (entry?.findings ?? []).map(
            (f) =>
              `- ${f.severity === 'severe' ? '🔴 grave' : '🟡 alerta'} · ${l} ${f.field}: ${f.reason}` +
              (f.end > f.start ? ` — "${excerpt(entry!, f.field, f.start, f.end).slice(0, 160)}"` : ''),
          );
        }),
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
