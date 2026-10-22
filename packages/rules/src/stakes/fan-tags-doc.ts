import { KNOCKOUT_FAMILIES, LEAGUE_FAMILIES, makeStake, type StakeFamily } from './codes.js';
import {
  fanTagOf,
  fanTagZoneGroup,
  FAN_TAG_RELEGATION_MAX_GAP,
  FAN_TAG_TIERS,
  FAN_TAG_TITLE_MIN_GAP,
  FAN_TAG_ZONE_MIN_GAP,
  MAX_FAN_TAGS,
  type FanTagLocale,
} from './fan-tags.js';
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
    '## Relevância para o torcedor (pontos corridos)',
    '',
    'Os stakes de mera possibilidade são matemáticos: com 7 rodadas, o 4º a 16 pontos do líder ainda tem',
    '`in_title_race`. Na tag do torcedor isso soa falso, então, com a tabela (`core.standing`) e o',
    'regulamento em mãos, três famílias só viram tag com proximidade real. Os `stakes` e suas frases não',
    'mudam; as tags decisivas de título, queda e vaga (`can_clinch_title`, `clinches_title_with_*`,',
    '`relegated_unless_wins`, `can_be_relegated`, `can_clinch_zone`…) valem sempre. As de permanência',
    'seguem o critério do rebaixamento.',
    '',
    '| Família | Vira tag quando | Constante |',
    '|---|---|---|',
    `| \`in_title_race\` | distância para o líder ≤ max(${FAN_TAG_TITLE_MIN_GAP}, rodadas restantes do time); o líder entra | \`FAN_TAG_TITLE_MIN_GAP\` |`,
    `| \`at_risk_of_relegation\` | o time está na zona de rebaixamento ou até ${FAN_TAG_RELEGATION_MAX_GAP} pontos acima do primeiro time dentro dela | \`FAN_TAG_RELEGATION_MAX_GAP\` |`,
    `| \`secures_safety_with_draw\`, \`secures_safety_with_win\`, \`can_secure_safety\`, \`safe_from_relegation\` | o mesmo critério do rebaixamento: na zona ou até ${FAN_TAG_RELEGATION_MAX_GAP} pontos acima do primeiro time dentro dela (permanência só interessa a quem está perto da zona) | \`FAN_TAG_RELEGATION_MAX_GAP\` |`,
    `| \`can_qualify_for_zone\` | distância para o último time dentro da zona ≤ max(${FAN_TAG_ZONE_MIN_GAP}, rodadas restantes do time) | \`FAN_TAG_ZONE_MIN_GAP\` |`,
    '',
    'Rodadas restantes = jogos da fase no regulamento (`matchesPerTeam`) − jogos do time. Sem tabela',
    '(mata-mata, competição sem regulamento) nada é filtrado. Exemplo (Brasileirão 2026, faltando 7',
    'rodadas): Cruzeiro, 16 pontos atrás do líder, fica sem "Na briga pelo título"; São Paulo e',
    'RB Bragantino, 10 e 9 pontos acima do Z4, ficam sem "Luta contra o rebaixamento"; Vitória e Mirassol',
    '(5 e 4 pontos acima) mantêm a tag. Cruzeiro, Athletico, Bahia e Atlético-MG, no alto da tabela, ficam',
    'sem "Vitória/Empate garante a permanência" e "Pode se salvar hoje", que valem só perto da zona.',
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
