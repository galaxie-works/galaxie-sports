/**
 * Cobertura das traduções dos textos livres (data/knowledge/i18n, docs/06 §3.3): por mercado, quantos
 * times e clássicos com texto em outro idioma já têm tradução e quais ainda caem no original.
 *   pnpm knowledge:i18n                          # resumo dos 12 locales de texto
 *   pnpm knowledge:i18n --locale es --faltando   # lista o que falta traduzir para o es
 *   pnpm knowledge:i18n --arquivo football/teams/br.yaml --faltando
 */
import { resolve } from 'node:path';
import { allTextCoverage } from '../i18n.js';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '../load.js';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = arg('--dir') ? resolve(process.env.INIT_CWD ?? '.', arg('--dir')!) : DEFAULT_KNOWLEDGE_DIR;
const onlyLocale = arg('--locale');
const onlyFile = arg('--arquivo');

const kb = await loadKnowledge(dir);
const rows = allTextCoverage(kb, onlyFile).filter((c) => !onlyLocale || c.locale === onlyLocale);
if (!rows.length) {
  console.error(`locale desconhecido: ${onlyLocale}`);
  process.exitCode = 1;
} else {
  console.table(
    rows.map((c) => ({
      locale: c.locale,
      'a traduzir': c.total,
      traduzidos: c.translated,
      'variante própria': c.own,
      faltando: c.missing.length,
    })),
  );
  if (args.includes('--faltando'))
    for (const c of rows) {
      if (!c.missing.length) continue;
      console.log(`\n${c.locale} — ${c.missing.length} sem tradução:`);
      for (const m of c.missing)
        console.log(`  ${m.kind === 'team' ? 'time    ' : 'clássico'} ${m.slug} (${m.file})`);
    }
}
