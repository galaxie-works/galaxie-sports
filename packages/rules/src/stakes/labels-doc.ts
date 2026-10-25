import {
  HISTORY_FAMILIES,
  KNOCKOUT_FAMILIES,
  LEAGUE_FAMILIES,
  RESULT_FAMILIES,
  makeStake,
  type StakeFamily,
  type StakeParams,
} from './codes.js';
import { STAKE_LOCALES, stakeText } from './labels.js';

/** Parâmetros de exemplo usados na documentação de cada família. */
export function exampleParams(family: StakeFamily): StakeParams | undefined {
  if (family === 'seeks_title_n') return { n: 4 };
  if (family === 'points_behind_zone_n') return { zone: 'sudamericana', n: 2 };
  if (family.includes('_zone')) return { zone: 'libertadores_group_stage' };
  if (/^(moved_up_to|moved_down_to|stayed_at)_n$/.test(family)) return { n: 13 };
  if (
    /(^|_)n(_|$)/.test(family) ||
    family.startsWith('specific_draw') ||
    family.startsWith('outcome_depends') ||
    family === 'title_depends_on_away_goals'
  ) {
    const draw = /^(advances_with_draw|specific_draw|wins_title_with_draw)/.test(family);
    return { n: draw ? 1 : 2 };
  }
  return undefined;
}

function section(family: StakeFamily): string {
  const stake = makeStake('home', family, exampleParams(family));
  const lines = [
    `### \`${family}\` — ex.: \`${stake.code}\``,
    '',
    '| Locale | Texto (exemplo) |',
    '|---|---|',
    ...STAKE_LOCALES.map((locale) => `| ${locale} | ${stakeText(stake, locale)} |`),
    '',
  ];
  return lines.join('\n');
}

/**
 * docs/rules/rotulos.md — gerado a partir de labels.ts
 * (`pnpm --filter @galaxie/rules docs:labels`; um teste garante que está em dia).
 */
export function renderLabelsMarkdown(): string {
  return [
    '# Rótulos localizados dos stakes',
    '',
    '> Arquivo **gerado** a partir de `packages/rules/src/stakes/labels.ts` por',
    '> `pnpm --filter @galaxie/rules docs:labels`. Não edite à mão: altere o mapa e regenere.',
    '> Códigos e semântica: [README](README.md#catálogo-de-códigos).',
    '',
    'Exemplos com `n = 2` (ou `n = 1` para empates específicos) e `zone = libertadores_group_stage`.',
    '',
    '## Mata-mata',
    '',
    ...KNOCKOUT_FAMILIES.map(section),
    '## Pontos corridos, grupos e fase de liga',
    '',
    ...LEAGUE_FAMILIES.map(section),
    '## Histórico (jogos que podem dar o título)',
    '',
    'Exemplo com `n = 4` (busca o 4º título). n = 1: "Busca o primeiro título"; n > 10: "Busca o 11º título".',
    '',
    ...HISTORY_FAMILIES.map(section),
    '## Resultado (pontos corridos, jogo encerrado)',
    '',
    'Exemplos com `n = 13` (posição), `n = 2` (pontos) e `zone = libertadores_group_stage`',
    '(`zone = sudamericana` em `points_behind_zone_n`). Variantes: n = 0 (empatado em pontos) e n = 1 (singular).',
    '',
    ...RESULT_FAMILIES.map(section),
  ].join('\n');
}
