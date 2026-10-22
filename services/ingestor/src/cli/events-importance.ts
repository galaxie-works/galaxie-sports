/**
 * Recalcula clássico (`derby_id`) e importância dos eventos já gravados (issue #39; revisão em docs/06 §3)
 * a partir do banco e dos YAML — zero chamadas ao fornecedor. Antes, aplica o `prestige` do catálogo
 * (config/competitions) em core.competition. Os sinais da tabela (título, rebaixamento, vaga) entram nos
 * jogos em aberto dos próximos `--horizonte` dias (padrão 7); roda de hora em hora no scheduler.
 *   pnpm --filter @galaxie/ingestor events:importance                       # todos os eventos
 *   pnpm --filter @galaxie/ingestor events:importance --esporte football --desde 2026-01-01
 *   pnpm --filter @galaxie/ingestor events:importance --esporte football --proximos-dias 7  # o do scheduler
 *   pnpm --filter @galaxie/ingestor events:importance --plan                # só mostra o que mudaria
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { loadFootballCatalog, loadSportCatalog } from '../catalog/catalog-config.js';
import { syncCompetitionPrestige } from '../catalog/prestige.js';
import { OTHER_SPORTS } from '../catalog/sport-catalog.js';
import { report } from '../logger.js';
import { recomputeEventImportance } from '../normalize/importance.js';
import { runCli } from './job-cli.js';

const catalogPath = (sport: string) => resolve(`../../config/competitions/${sport}.yaml`);

function parseDate(value: string, flag: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${flag} precisa ser uma data (AAAA-MM-DD).`);
  return d;
}

function parseDays(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} precisa ser um número de dias >= 0.`);
  return n;
}

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      esporte: { type: 'string' },
      desde: { type: 'string' },
      ate: { type: 'string' },
      'proximos-dias': { type: 'string' },
      horizonte: { type: 'string' },
      evento: { type: 'string', multiple: true },
      'sem-catalogo': { type: 'boolean', default: false },
      plan: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const now = new Date();
  let since = values.desde ? parseDate(values.desde, '--desde') : undefined;
  let until = values.ate ? parseDate(values.ate, '--ate') : undefined;
  if (values['proximos-dias'] !== undefined) {
    // janela do scheduler: o que começou nas últimas 6 h (ao vivo) até N dias à frente
    since ??= new Date(now.getTime() - 6 * 3600_000);
    until ??= new Date(now.getTime() + parseDays(values['proximos-dias'], '--proximos-dias') * 86_400_000);
  }
  const db = createDb(url);
  try {
    // prestígio do catálogo (YAML → core.competition); o --plan só calcula com ele
    const prestigeOverride = new Map<string, number>();
    let prestigeChanged = 0;
    if (!values['sem-catalogo']) {
      const sports = values.esporte ? [values.esporte] : ['football', ...OTHER_SPORTS];
      for (const sport of sports) {
        const entries =
          sport === 'football'
            ? await loadFootballCatalog(catalogPath(sport))
            : await loadSportCatalog(catalogPath(sport));
        for (const e of entries) prestigeOverride.set(`${sport}|${e.slug}`, e.prestige ?? 0);
        if (!values.plan) prestigeChanged += await syncCompetitionPrestige(db, sport, entries);
      }
    }
    const result = await recomputeEventImportance(db, {
      ...(values.esporte ? { sport: values.esporte } : {}),
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      ...(values.evento?.length ? { eventIds: values.evento } : {}),
      ...(values.horizonte !== undefined
        ? { stakesHorizonDays: parseDays(values.horizonte, '--horizonte') }
        : {}),
      prestigeOverride,
      now,
      dryRun: values.plan,
    });
    report(values.plan ? 'Importância (plano — nada foi gravado)' : 'Importância recalculada', [
      {
        eventos: result.examined,
        classicos: result.derbies,
        'clássico alterado': result.derbiesChanged,
        'importância alterada': result.importanceChanged,
        'jogos com stakes calculados': result.stakesComputed,
        'com sinal da tabela': result.withStakeFlags,
        ...(values.plan ? {} : { 'prestígio aplicado (competições)': prestigeChanged }),
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
