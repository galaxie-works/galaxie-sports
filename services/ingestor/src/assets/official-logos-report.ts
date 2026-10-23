/**
 * Relatório do acervo oficial de logos (docs/research/logos-acervo-oficial.md): quantos componentes
 * viraram logo principal, logo de canal ou variante HD, quais emissoras são novas na biblioteca e a
 * lista dos sem mapeamento para a curadoria. Gerado junto com o manifesto (`--plan`).
 */
import type { LibraryEntry, OfficialLogoManifest } from '@galaxie/where-to-watch';

/** Nota que marca, no manifesto, o logo de uma emissora criada a partir do acervo. */
export const NEW_BROADCASTER_NOTE = 'emissora nova na biblioteca (acervo oficial)';

export function officialLogoReport(
  manifest: OfficialLogoManifest,
  library: LibraryEntry[],
  /** Componentes sem SVG exportado (o Figma não exporta símbolos fora da área do frame). */
  withoutFile: string[] = [],
): string {
  const logos = manifest.logos;
  const names = new Map(library.map((b) => [b.id, b]));
  const primary = logos.filter((l) => l.status === 'primary');
  const channels = logos.filter((l) => l.status === 'channel');
  const variants = logos.filter((l) => l.status === 'variant');
  const unmapped = logos.filter((l) => l.status === 'unmapped');
  const created = primary.filter((l) => l.note === NEW_BROADCASTER_NOTE);
  const existing = primary.filter((l) => l.note !== NEW_BROADCASTER_NOTE);
  const withLogo = new Set(primary.map((l) => l.broadcaster));
  const without = library.filter((b) => !withLogo.has(b.id));
  const label = (id: string | null) => (id ? `${names.get(id)?.name ?? id} (\`${id}\`)` : '—');
  const countries = (id: string | null) => (id ? (names.get(id)?.countries.join(', ') ?? '') : '');
  const lines: string[] = [
    '# Acervo oficial de logos de canais → biblioteca de emissoras',
    '',
    `> Gerado por \`pnpm --filter @galaxie/ingestor assets:official-logos --plan\` em ${manifest.source.importedAt}.`,
    '> Manifesto: [`config/broadcasters/_official_logos.yaml`](../../config/broadcasters/_official_logos.yaml).',
    '',
    `Fonte: ${manifest.source.description} — arquivo \`${manifest.source.fileKey}\`, nó \`${manifest.source.node}\`.`,
    'Cada componente tem as versões clara e escura (a demo usa a escura); o logo sem "HD" é o principal',
    'e o HD fica como variante. Os arquivos ficam no bucket de assets, não no git.',
    '',
    '## Resumo',
    '',
    '| | Componentes |',
    '| --- | ---: |',
    `| No acervo (fora os excluídos) | ${logos.length} |`,
    `| Logo principal de emissora que já existia | ${existing.length} |`,
    `| Logo principal de emissora nova na biblioteca | ${created.length} |`,
    `| Logo de canal de uma emissora (ex.: ESPN 2) | ${channels.length} |`,
    `| Variante HD de um logo já ligado | ${variants.length} |`,
    `| **Sem mapeamento** (curadoria) | **${unmapped.length}** |`,
    `| Excluídos (marca própria de operadora; decisão da curadoria) | ${manifest.excludedNodes.length} |`,
    '',
    `Emissoras da biblioteca com logo oficial: ${withLogo.size} de ${library.length}.`,
    '',
    '## Emissoras com logo oficial',
    '',
    '| Emissora | Países | Logo principal | Canais |',
    '| --- | --- | --- | --- |',
    ...[...primary]
      .sort((a, b) => (a.broadcaster ?? '').localeCompare(b.broadcaster ?? ''))
      .map((l) => {
        const ch = channels
          .filter((c) => c.broadcaster === l.broadcaster)
          .map((c) => c.channel)
          .join(', ');
        const isNew = l.note === NEW_BROADCASTER_NOTE ? ' · **nova**' : '';
        return `| ${label(l.broadcaster)}${isNew} | ${countries(l.broadcaster)} | ${l.name} | ${ch || '—'} |`;
      }),
    '',
  ];
  const orphanChannels = channels.filter((c) => !withLogo.has(c.broadcaster));
  if (orphanChannels.length)
    lines.push(
      'Logos de canal de emissoras sem logo principal no acervo:',
      '',
      ...orphanChannels.map((c) => `- ${label(c.broadcaster)}: ${c.channel} (${c.name})`),
      '',
    );
  lines.push(
    '## Biblioteca sem logo oficial',
    '',
    'Continuam com o logo da Wikimedia Commons (config/broadcasters/_logos.yaml), quando há, ou sem logo:',
    '',
    without.map((b) => `\`${b.id}\``).join(', ') || '—',
    '',
    '## Sem mapeamento',
    '',
    'Componentes do acervo sem emissora correspondente na biblioteca. Para ligar um deles, crie a emissora',
    'no dicionário do país (config/broadcasters/<iso2>.yaml) ou fixe o mapeamento no manifesto',
    '(`broadcaster`, `status`, `curated: true`).',
    '',
  );
  const byLetter = new Map<string, typeof unmapped>();
  for (const l of unmapped) byLetter.set(l.letter, [...(byLetter.get(l.letter) ?? []), l]);
  for (const [letter, list] of [...byLetter].sort(([a], [b]) => a.localeCompare(b)))
    lines.push(
      `- **${letter}** — ${list.map((l) => `${l.name}${l.note ? ` _(${l.note})_` : ''}`).join(' · ')}`,
    );
  lines.push('');
  if (withoutFile.length)
    lines.push(
      '## Sem arquivo exportado',
      '',
      `O Figma não exporta estes componentes (estão fora da área recortada do frame do acervo): ${withoutFile.join(', ')}. Para incluí-los, mova a linha para dentro do frame e reexporte.`,
      '',
    );
  return lines.join('\n');
}
