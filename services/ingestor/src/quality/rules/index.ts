/** Todas as regras de qualidade, na ordem do relatório. Regra nova: no arquivo da área e na lista abaixo. */
import type { QualityRule } from '../types.js';
import { CATALOG_RULES } from './catalog.js';
import { EVENT_RULES } from './events.js';
import { F1_RULES } from './f1.js';
import { GEO_RULES } from './geo.js';
import { STANDINGS_RULES } from './standings.js';
import { WATCH_RULES } from './watch.js';
import { WIKIDATA_RULES } from './wikidata.js';

export const QUALITY_RULES: readonly QualityRule[] = [
  ...F1_RULES,
  ...GEO_RULES,
  ...EVENT_RULES,
  ...STANDINGS_RULES,
  ...CATALOG_RULES,
  ...WIKIDATA_RULES,
  ...WATCH_RULES,
];
