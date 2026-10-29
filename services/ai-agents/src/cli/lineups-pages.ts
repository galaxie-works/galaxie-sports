/**
 * Confirma a grade de canais e os inclusos de cada plano pela página oficial, lida do nosso lado (sem
 * LLM): robots.txt, User-Agent do projeto, intervalo entre requisições e cache por URL (25 dias).
 *   pnpm --filter @galaxie/ai-agents lineups:pages --plan --pais BR            # quais páginas seriam lidas
 *   pnpm --filter @galaxie/ai-agents lineups:pages --pais BR,AR                # lê e grava como rascunho
 *   pnpm --filter @galaxie/ai-agents lineups:pages --plataforma <slug> --forcar
 * Opções: --pais (padrão: BR, AR, MX, CO, CL), --plataforma <slug>, --forcar (ignora o cache),
 * --max-paginas N (por execução, padrão 30), --renderizar (abre o Chromium local, desenvolvimento).
 * Página que só mostra a grade com JavaScript precisa de navegador: `LINEUP_RENDER_WS` aponta para um
 * servidor do Playwright (contêiner à parte, ver docs/07 §2.2.2); sem ele, a página fica `needs_render`
 * e a grade daquele plano, não verificada. Agendado no perfil `agents` como `lineups-pages`.
 */
import { parseArgs } from 'node:util';
import { and, inArray, ne } from 'drizzle-orm';
import { closeDb, getPlatformLineup, platform } from '@galaxie/db';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { candidatePages, confirmFromPages } from '../lineups/confirm.js';
import { dbPageStore, OfficialPageReader, type PageRenderer } from '../lineups/pages.js';
import { LINEUP_COUNTRIES } from '../lineups/research.js';
import { dbFromEnv, intFlag } from './common.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      pais: { type: 'string' },
      plataforma: { type: 'string' },
      forcar: { type: 'boolean', default: false },
      'max-paginas': { type: 'string' },
      renderizar: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const countries = (
    values.pais
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) ?? [...LINEUP_COUNTRIES]
  ).filter((c, i, all) => all.indexOf(c) === i);
  const config = loadWtwConfig();
  const db = dbFromEnv();
  let renderer: PageRenderer | null = null;
  try {
    if (values.plan) {
      const rows = await db
        .select()
        .from(platform)
        .where(and(inArray(platform.country, countries), ne(platform.reviewStatus, 'rejected')));
      const list: { pais: string; plataforma: string; pagina: string }[] = [];
      for (const r of rows.filter((r) => !values.plataforma || r.slug === values.plataforma)) {
        const l = await getPlatformLineup(db, r.id, { minReview: 'draft', includeUnverified: true });
        const urls = l
          ? candidatePages(
              r,
              l.plans.map((p) => ({
                url: p.plan.url,
                sources: p.plan.sources,
                verification: p.plan.verification,
              })),
              3,
            )
          : [];
        for (const u of urls.length ? urls : ['(sem página oficial conhecida)'])
          list.push({ pais: r.country, plataforma: r.slug, pagina: u });
      }
      console.table(list);
      console.log('PRÉVIA: nada buscado, nada gravado.');
      return;
    }
    const ws = process.env.LINEUP_RENDER_WS?.trim();
    if (ws || values.renderizar) {
      const { playwrightRenderer } = await import('../lineups/render.js');
      renderer = await playwrightRenderer({
        wsEndpoint: ws || null,
        executablePath: process.env.LINEUP_RENDER_CHROMIUM?.trim() || null,
      });
      console.log(`Navegador: ${ws ? `servidor ${ws}` : 'Chromium local'}`);
    } else console.log('Sem navegador (LINEUP_RENDER_WS): só HTML estático e JSON embutido.');
    const reader = new OfficialPageReader({
      store: dbPageStore(db),
      renderer,
      maxPages: intFlag(values['max-paginas'], 'max-paginas') ?? 30,
      log: (m) => console.log(`  ${m}`),
    });
    const outcomes = await confirmFromPages(
      { db, config, reader, log: (m) => console.log(`  ${m}`) },
      { countries, force: values.forcar, ...(values.plataforma ? { platformSlug: values.plataforma } : {}) },
    );
    for (const o of outcomes) {
      console.log(
        `${o.country} · ${o.slug}: ${o.plans.length} plano(s), ${o.addons} complemento(s), ` +
          `${o.created} novo(s), ${o.updated} atualizado(s), ${o.changes.length} mudança(s) para revisar`,
      );
      for (const p of o.pages)
        console.log(
          `    ${p.status}${p.via ? ` (${p.via})` : ''}${p.fromCache ? ' · cache' : ''}${p.hashChanged ? ' · MUDOU' : ''} · ${p.url}${p.error ? ` — ${p.error}` : ''}`,
        );
      if (o.unknownAddons.length)
        console.log(`    complementos fora da biblioteca: ${o.unknownAddons.join(', ')}`);
      for (const { item, flag } of o.flagged)
        console.log(`    sinalizado (entrou sem o valor): ${item} · ${flag.reason}`);
      if (o.error) console.log(`    ERRO: ${o.error}`);
    }
    console.log(
      `${reader.pagesFetched} página(s) buscada(s). Tudo entrou como rascunho (com a fonte oficial e o hash): aprove no painel.`,
    );
    if (outcomes.some((o) => o.error)) process.exitCode = 1;
  } finally {
    await renderer?.close().catch(() => undefined);
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
