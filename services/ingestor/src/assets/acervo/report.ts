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

export interface CountryCoverage {
  country: string;
  total: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
  rejected: number;
}

const isLinked = (l: AcervoLogo) => (l.match === 'auto' || l.match === 'manual') && !!l.target_id;

export function coverage(logos: AcervoLogo[]): CountryCoverage[] {
  const by = new Map<string, CountryCoverage>();
  for (const l of logos) {
    const c = by.get(l.country) ?? {
      country: l.country,
      total: 0,
      linked: 0,
      ambiguous: 0,
      unmatched: 0,
      rejected: 0,
    };
    c.total += 1;
    if (isLinked(l)) c.linked += 1;
    else if (l.match === 'ambiguous') c.ambiguous += 1;
    else if (l.match === 'rejected') c.rejected += 1;
    else c.unmatched += 1;
    by.set(l.country, c);
  }
  const rank = (code: string) => {
    const i = (PRIORITY_COUNTRIES as readonly string[]).indexOf(code);
    return i === -1 ? PRIORITY_COUNTRIES.length : i;
  };
  return [...by.values()].sort(
    (a, b) => rank(a.country) - rank(b.country) || b.total - a.total || a.country.localeCompare(b.country),
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;

export function renderReport(manifest: AcervoManifest, unknownCountries: string[] = []): string {
  const { acervo, logos } = manifest;
  const cov = coverage(logos);
  const total = cov.reduce(
    (acc, c) => ({
      total: acc.total + c.total,
      linked: acc.linked + c.linked,
      ambiguous: acc.ambiguous + c.ambiguous,
      unmatched: acc.unmatched + c.unmatched,
      rejected: acc.rejected + c.rejected,
    }),
    { total: 0, linked: 0, ambiguous: 0, unmatched: 0, rejected: 0 },
  );
  const out: string[] = [
    `# Cobertura do acervo \`${acervo.id}\``,
    '',
    `Gerado por \`assets:acervo --mapear\` em ${manifest.generated_at}.`,
    '',
    `- **Acervo:** ${acervo.name}, revisão \`${acervo.revision}\``,
    `- **Autor:** ${acervo.author}`,
    `- **Licença:** ${acervo.license}`,
    ...(acervo.url ? [`- **Origem:** ${acervo.url}`] : []),
    `- **Logos:** ${total.total}: ${total.linked} ligados (${pct(total.linked, total.total)}), ${total.ambiguous} ambíguos, ${total.unmatched} sem par${total.rejected ? `, ${total.rejected} recusados na curadoria` : ''}`,
    ...(unknownCountries.length
      ? [`- **Pastas de país não reconhecidas:** ${unknownCountries.join(', ')}`]
      : []),
    '',
    '## Por país',
    '',
    'Países da navegação e grandes ligas europeias primeiro.',
    '',
    row(['País', 'Logos', 'Ligados', 'Ambíguos', 'Sem par', 'Cobertura']),
    row(['---', '---:', '---:', '---:', '---:', '---:']),
    ...cov.map((c) => row([c.country, c.total, c.linked, c.ambiguous, c.unmatched, pct(c.linked, c.total)])),
  ];

  const ambiguous = logos.filter((l) => l.match === 'ambiguous');
  if (ambiguous.length) {
    out.push(
      '',
      '## Ambíguos (curadoria)',
      '',
      'Escolha o alvo no manifesto (`target_id` + `match: manual`) ou recuse (`match: rejected`).',
      '',
      row(['País', 'Logo', 'Candidatos']),
      row(['---', '---', '---']),
      ...ambiguous.map((l) =>
        row([
          l.country,
          `\`${l.key}\` (${l.name})`,
          (l.candidates ?? []).map((c) => `${c.name} \`${c.id}\` ${c.confidence.toFixed(2)}`).join('; '),
        ]),
      ),
    );
  }
  const unmatched = logos.filter((l) => l.match === 'unmatched');
  if (unmatched.length) {
    out.push('', '## Sem par', '', row(['País', 'Logo']), row(['---', '---']));
    out.push(...unmatched.map((l) => row([l.country, `\`${l.key}\` (${l.name})`])));
  }
  return `${out.join('\n')}\n`;
}
