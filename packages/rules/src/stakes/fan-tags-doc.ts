import { KNOCKOUT_FAMILIES, LEAGUE_FAMILIES, makeStake, type StakeFamily } from './codes.js';
import { fanTagOf, fanTagZoneGroup, FAN_TAG_TIERS, MAX_FAN_TAGS, type FanTagLocale } from './fan-tags.js';
import { exampleParams } from './labels-doc.js';

/** Locales exibidos na documentação (os demais es-* seguem es-AR, salvo as variações listadas). */
const DOC_LOCALES: readonly FanTagLocale[] = ['pt-BR', 'es-AR', 'en'];

const ZONE_FAMILIES = new Set<StakeFamily>([
  'qualifies_for_zone',
  'clinches_zone_with_draw',
  'clinches_zone_with_win',
  'can_clinch_zone',
  'can_qualify_for_zone',
]);

/** Zonas de exemplo, uma por grupo de tags. */
const DOC_ZONES = [
  'libertadores_group_stage',
  'libertadores_qualifying',
  'sudamericana',
  'champions_league',
  'champions_league_qualifying',
  'europa_league',
  'conference_league',
  'promotion',
  'round_of_16',
  'knockout_playoff',
  'playoff',
  'zona_desconhecida',
];

function row(family: StakeFamily, zone?: string): string {
  const params = zone ? { zone } : exampleParams(family);
  const stake = makeStake('home', family, params);
  const tag = fanTagOf(stake, DOC_LOCALES);
  if (!tag) return `| \`${family}\` | \`${stake.code}\` | — | _sem tag (informativo)_ | | |`;
  return `| \`${family}\` | \`${stake.code}\` | ${tag.priority} | ${DOC_LOCALES.map((l) => tag.text[l]).join(' | ')} |`;
}

const HEADER = [
  '| Família | Código (exemplo) | `priority` | pt-BR | es-AR | en |',
  '|---|---|---|---|---|---|',
];

/**
 * docs/rules/tags-torcedor.md — gerado a partir de fan-tags.ts
 * (`pnpm --filter @galaxie/rules docs:labels`; um teste garante que está em dia).
 */
export function renderFanTagsMarkdown(): string {
  const families = [...KNOCKOUT_FAMILIES, ...LEAGUE_FAMILIES].filter((f) => !ZONE_FAMILIES.has(f));
  const tiers = Object.entries(FAN_TAG_TIERS)
    .map(([tier, base]) => `\`${tier}\` = ${base}`)
    .join(', ');
  return [
    '# Tags do torcedor (`fan_tags`)',
    '',
    '> Arquivo **gerado** a partir de `packages/rules/src/stakes/fan-tags.ts` por',
    '> `pnpm --filter @galaxie/rules docs:labels`. Não edite à mão: altere a tabela e regenere.',
    '> Uso na API: [docs/05 §3.2](../05-api-publica.md#32-eventos).',
    '',
    'Rótulos curtos (até ~30 caracteres), do ponto de vista de quem torce para o time, derivados dos',
    '[stakes](README.md#catálogo-de-códigos) por esta tabela fixa — nenhum texto é gerado livremente.',
    '',
    `- **Faixas de relevância** (\`priority\` = base da faixa + ordem dentro dela; menor = mais importante): ${tiers}.`,
    '- Stakes `both` valem para os dois participantes.',
    '- Tags de texto idêntico são fundidas: fica a de menor `priority` (e o `code` dela).',
    `- No máximo ${MAX_FAN_TAGS} tags por participante; empate de \`priority\` segue a ordem dos stakes.`,
    '- Os mercados es-* usam o texto de es-AR, com as variações regionais de prorrogação',
    '  (*tiempos extra* no MX, *tiempo extra* no CO/EC, *suplementario* no PE), "lucha" no lugar de',
    '  "pelea" (MX) e *liguilla* para `playoff` (MX). `en` é a reserva da cadeia de fallback.',
    '',
    'Exemplos com `n = 2` (ou `n = 1` para empates específicos).',
    '',
    '## Códigos sem zona',
    '',
    ...HEADER,
    ...families.map((f) => row(f)),
    '',
    '## Códigos com zona',
    '',
    'O texto depende do verbo (vaga garantida, pode garantir nesta rodada, ainda em disputa) e do grupo da',
    'zona. Zonas de mata-mata da fase de liga (`round_of_16`, `knockout_playoff`, `playoff`) entram na faixa',
    '`knockout`; vagas continentais e acesso, na faixa `qualification`. Zona fora da tabela usa o grupo',
    '`generic`.',
    '',
    ...HEADER,
    ...DOC_ZONES.flatMap((zone) => [
      `| **${fanTagZoneGroup(zone)}** | | | | | |`,
      ...[...ZONE_FAMILIES].map((f) => row(f, zone)),
    ]),
    '',
  ].join('\n');
}
