/**
 * Relatório de cobertura do mapeamento (Markdown, ao lado do manifesto): por país, quantos logos foram
 * ligados, quantos estão ambíguos (fila da curadoria) e quantos ficaram sem par — primeiro os países da
 * navegação da demo, depois as grandes ligas europeias, depois o resto.
 */
import type { AcervoLogo, AcervoManifest } from './manifest.js';

/** Países da navegação (América Latina) e grandes ligas europeias, nesta ordem. */
export const PRIORITY_COUNTRIES = [
  'BR',
  'AR',
  'MX',
  'CO',
  'CL',
  'PE',
  'UY',
  'EC',
  'PY',
  'BO',
  'VE',
  'GB-ENG',
  'ES',
  'IT',
  'DE',
  'FR',
  'PT',
  'NL',
] as const;

export interface Coverage {
  /** País (código) ou pasta de competição do pacote. */
  label: string;
  total: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
  duplicate: number;
  rejected: number;
}
/** Cobertura de um país (`country` = `label`). */
export type CountryCoverage = Coverage & { country: string };

const isLinked = (l: AcervoLogo) => (l.match === 'auto' || l.match === 'manual') && !!l.target_id;

function tally(logos: AcervoLogo[], labelOf: (l: AcervoLogo) => string): Map<string, Coverage> {
  const by = new Map<string, Coverage>();
  for (const l of logos) {
    const label = labelOf(l);
    const c = by.get(label) ?? {
      label,
      total: 0,
      linked: 0,
      ambiguous: 0,
      unmatched: 0,
      duplicate: 0,
      rejected: 0,
    };
    c.total += 1;
    if (isLinked(l)) c.linked += 1;
    else if (l.match === 'ambiguous') c.ambiguous += 1;
    else if (l.match === 'rejected') c.rejected += 1;
    else if (l.match === 'duplicate') c.duplicate += 1;
    else c.unmatched += 1;
    by.set(label, c);
  }
  return by;
}

/** Cobertura por país, os da navegação e as grandes ligas europeias primeiro. */
export function coverage(logos: AcervoLogo[]): CountryCoverage[] {
  const rank = (code: string) => {
    const i = (PRIORITY_COUNTRIES as readonly string[]).indexOf(code);
    return i === -1 ? PRIORITY_COUNTRIES.length : i;
  };
  return [...tally(logos, (l) => l.country).values()]
    .map((c) => ({ ...c, country: c.label }))
    .sort(
      (a, b) => rank(a.country) - rank(b.country) || b.total - a.total || a.country.localeCompare(b.country),
    );
}

/** Cobertura por pasta de competição do pacote (só quando o pacote tem pastas por competição). */
export function coverageByGroup(logos: AcervoLogo[]): Coverage[] {
  return [
    ...tally(
      logos.filter((l) => l.group),
      (l) => l.group!,
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const where = (l: AcervoLogo) => l.group ?? l.country;
const head = ['Logos', 'Ligados', 'Ambíguos', 'Sem par', 'Duplicados', 'Cobertura'];
const line = (label: string, c: Coverage) =>
  row([label, c.total, c.linked, c.ambiguous, c.unmatched, c.duplicate, pct(c.linked, c.total)]);

export function renderReport(manifest: AcervoManifest, unknownCountries: string[] = []): string {
  const { acervo, logos } = manifest;
  const cov = coverage(logos);
  const byGroup = coverageByGroup(logos);
  const total = [...tally(logos, () => 'total').values()][0] ?? {
    label: 'total',
    total: 0,
    linked: 0,
    ambiguous: 0,
    unmatched: 0,
    duplicate: 0,
    rejected: 0,
  };
  const out: string[] = [
    `# Cobertura do acervo \`${acervo.id}\``,
    '',
    `Gerado por \`assets:acervo --mapear\` em ${manifest.generated_at}.`,
    '',
    `- **Acervo:** ${acervo.name}, revisão \`${acervo.revision}\``,
    `- **Autor:** ${acervo.author}`,
    `- **Licença:** ${acervo.license}`,
    ...(acervo.url ? [`- **Origem:** ${acervo.url}`] : []),
    `- **Logos:** ${total.total}: ${total.linked} ligados (${pct(total.linked, total.total)}), ${total.ambiguous} ambíguos, ${total.unmatched} sem par${total.duplicate ? `, ${total.duplicate} duplicados (o mesmo time já ligado pela pasta da liga nacional)` : ''}${total.rejected ? `, ${total.rejected} recusados na curadoria` : ''}`,
    ...(unknownCountries.length ? [`- **Países não reconhecidos:** ${unknownCountries.join(', ')}`] : []),
  ];
  if (byGroup.length)
    out.push(
      '',
      '## Por competição',
      '',
      row(['Pasta', ...head]),
      row(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
      ...byGroup.map((c) => line(c.label, c)),
    );
  out.push(
    '',
    '## Por país',
    '',
    'Países da navegação e grandes ligas europeias primeiro.',
    '',
    row(['País', ...head]),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
    ...cov.map((c) => line(c.country, c)),
  );

  const ambiguous = logos.filter((l) => l.match === 'ambiguous');
  if (ambiguous.length) {
    out.push(
      '',
      '## Ambíguos (curadoria)',
      '',
      'Escolha o alvo no manifesto (`target_id` + `match: manual`) ou recuse (`match: rejected`).',
      '',
      row(['Onde', 'Logo', 'Candidatos']),
      row(['---', '---', '---']),
      ...ambiguous.map((l) =>
        row([
          where(l),
          `\`${l.key}\` (${l.name})`,
          (l.candidates ?? []).map((c) => `${c.name} \`${c.id}\` ${c.confidence.toFixed(2)}`).join('; '),
        ]),
      ),
    );
  }
  const unmatched = logos.filter((l) => l.match === 'unmatched');
  if (unmatched.length) {
    out.push('', '## Sem par', '', row(['Onde', 'Logo']), row(['---', '---']));
    out.push(...unmatched.map((l) => row([where(l), `\`${l.key}\` (${l.name})`])));
  }
  return `${out.join('\n')}\n`;
}
