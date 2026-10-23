#!/usr/bin/env node
// Gera um item de registry shadcn pela linha de comando (usa o dist: rode `pnpm --filter @galaxie/widgets build`).
//
//   node scripts/registry-item.mjs <kind> <nome> [--theme dark|light|emerald|sunset] [--api URL]
//        [--locale pt-BR|es|en] [--market BR] [--event ID] [--competition ID] [--sport football] [--out arquivo.json]
//
// Ex.: node scripts/registry-item.mjs match_card "Operadora Exemplo Placar" --event <id> --out item.json
//      npx shadcn@latest add ./item.json
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { DEFAULT_THEMES, buildRegistryItem } from '../dist/index.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: 'string', default: 'dark' },
    api: { type: 'string', default: 'https://api.galaxie.sports' },
    locale: { type: 'string', default: 'pt-BR' },
    market: { type: 'string', default: 'BR' },
    event: { type: 'string' },
    competition: { type: 'string' },
    sport: { type: 'string' },
    out: { type: 'string' },
  },
});

const [kind, name] = positionals;
if (!kind || !name) {
  console.error('uso: registry-item.mjs <match_card|live_list|standings|where_to_watch> <nome> [opções]');
  process.exit(1);
}
const theme = DEFAULT_THEMES[values.theme];
if (!theme) {
  console.error(`tema desconhecido: ${values.theme} (${Object.keys(DEFAULT_THEMES).join(', ')})`);
  process.exit(1);
}

const item = buildRegistryItem({
  kind,
  name,
  theme,
  apiBaseUrl: values.api,
  locale: values.locale,
  market: values.market,
  defaults: { eventId: values.event, competitionId: values.competition, sport: values.sport },
});
const json = `${JSON.stringify(item, null, 2)}\n`;
if (values.out) writeFileSync(values.out, json);
else process.stdout.write(json);
