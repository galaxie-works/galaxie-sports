// Gera src/prices.generated.ts a partir de config/ai-pricing.yaml (#1438). O painel e o app Next usam a tabela
// sem ler arquivo; src/prices.test.ts falha se o gerado divergir do yaml. Rodar: pnpm --filter @galaxie/ai-ledger gen:prices
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const src = fileURLToPath(new URL('../../../config/ai-pricing.yaml', import.meta.url));
const out = fileURLToPath(new URL('../src/prices.generated.ts', import.meta.url));
const data = parse(readFileSync(src, 'utf8'));
writeFileSync(
  out,
  [
    '// Gerado por packages/ai-ledger/scripts/gen-prices.mjs a partir de config/ai-pricing.yaml. Não edite à mão.',
    "import type { PricingData } from './pricing-data.js';",
    '',
    `export const PRICING_DATA: PricingData = ${JSON.stringify(data, null, 2)};`,
    '',
  ].join('\n'),
);
console.log(`gerado ${out}`);
