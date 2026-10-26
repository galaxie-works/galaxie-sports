/**
 * Ordem do Gemini para o acervo de fotos da F1 (passo da VPS, onde a chave funciona) — docs/runbooks/fotos-commons.md.
 *   node dist/cli/assets-commons-ordenar.js --plan                          # prévia: alvos a ordenar, sem chamar nada
 *   node dist/cli/assets-commons-ordenar.js --saida /data/commons/f1.yaml   # ordena e grava o manifesto
 * Para cada alvo do manifesto ainda sem a ordem do Gemini: busca as candidatas na Commons, aplica as regras e
 * manda as 12 melhores ao Gemini (visão), que classifica (retrato, ação, carro), descarta o que não é foto real
 * e dá a nota. A licença, a resolução, a época e a categoria continuam decididas pelas regras; a IA não
 * acrescenta foto. Curadoria (`manual`, `rejected`) fica.
 *
 * Idempotente: o alvo ordenado guarda o modelo e a data (`ranking`) e não é refeito sem --refazer; se o Gemini
 * falhar, o alvo fica como estava e volta na próxima execução. A base é o manifesto de entrada (o do repositório,
 * com os alvos novos); do --saida de uma execução anterior vêm só os alvos já ordenados (com o carro de destaque
 * da entrada), então rodar de novo continua de onde parou.
 *
 * Opções: --manifesto <arquivo> (entrada; padrão: o do repositório), --saida <arquivo> (padrão: a entrada),
 * --so driver/ayrton-senna,car/mclaren/1988, --tipo car|driver, --limite <n> (alvos por execução), --refazer
 * (com --tipo car, refaz os carros com a nota do fundo do heading, `hero`).
 * Ambiente: GEMINI_API_KEY e GEMINI_MODEL_VISION (padrão: o leve da camada de IA).
 *
 * Orçamento: cada chamada entra no ledger diário de IA (`ops.llm_usage`) como agente `assets`, com o estado
 * e os tetos dos agentes (AI_STATUS, AI_DAILY_USD_BUDGET, AI_AGENT_USD_BUDGETS `assets=1`), já com as
 * sobrescritas do painel, e na faixa `manual` da política de execução (config/ai-policy.yaml). Sem saldo,
 * os alvos restantes ficam como estavam e voltam na próxima execução.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PgTokenBudgetStore,
  TokenBudget,
  defaultAiPolicyFile,
  isManualRun,
  ledgerPolicy,
  ledgerSettingsFromEnv,
  loadAiPolicyOrEmpty,
} from '@galaxie/ai-ledger';
import { closeDb, createDb } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import { panelEnv } from '../assets/commons/panel-env.js';
import {
  ASSETS_AGENT,
  GEMINI_VISION_DEFAULT_MODEL,
  geminiRanker,
  rankEstimate,
  rankPrompt,
} from '../assets/commons/gemini.js';
import { loadF1dbForCommons, targetsByKey } from '../assets/commons/load.js';
import { readManifest, writeManifest } from '../assets/commons/manifest.js';
import {
  AI_POOL,
  coverageReport,
  isRanked,
  mapCommons,
  mergeRanked,
  writeReport,
} from '../assets/commons/map.js';
import { listArg, parseArgs } from '../multisport/cli-args.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const root = join(import.meta.dirname, '..', '..', '..', '..');
const input = String(args.get('manifesto') ?? join(root, 'config', 'assets', 'commons', 'f1.yaml'));
const output = String(args.get('saida') ?? input);
const only = listArg(args, 'so');
const kind = args.has('tipo') ? String(args.get('tipo')) : null;
if (kind && kind !== 'car' && kind !== 'driver') throw new Error('--tipo: use car ou driver');
const limit = args.has('limite') ? Number(args.get('limite')) : Number.POSITIVE_INFINITY;
const redo = args.has('refazer');
const plan = args.has('plan');
const model = process.env.GEMINI_MODEL_VISION?.trim() || GEMINI_VISION_DEFAULT_MODEL;
const log = (m: string) => console.log(m);

const base = readManifest(input);
if (!base) throw new Error(`Manifesto não encontrado: ${input} (rode assets:commons --mapear).`);
// alvos já ordenados numa execução anterior (--saida) continuam: rodar de novo continua de onde parou
const previous = output !== input && existsSync(output) ? readManifest(output) : null;
if (previous) base.entries = mergeRanked(base.entries, previous.entries);
const pending = base.entries
  .filter((e) => !only || only.includes(e.target))
  .filter((e) => !kind || e.kind === kind)
  .filter((e) => redo || !isRanked(e))
  .slice(0, limit);

if (plan) {
  console.table(
    base.entries
      .filter((e) => !only || only.includes(e.target))
      .map((e) => ({
        alvo: e.target,
        fotos: e.photos.filter((p) => p.match !== 'rejected').length,
        ordem: e.ranking ? `Gemini (${e.ranking.model}, ${e.ranking.at})` : 'regras',
        agora: pending.includes(e) ? 'ordenar' : '—',
      })),
  );
  const perTarget = rankEstimate([rankPrompt('—', 'car', AI_POOL)], AI_POOL, model).usd;
  console.log(
    `PRÉVIA (nada chamado, nada gravado): ${pending.length} alvo(s) a ordenar com ${model}, ` +
      `1 chamada ao Gemini por alvo com até ${AI_POOL} miniaturas (reserva de até US$ ${perTarget.toFixed(4)} por alvo ` +
      `no teto do agente ${ASSETS_AGENT}); base ${input}${previous ? ` + alvos já ordenados de ${output}` : ''}`,
  );
} else {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('Defina GEMINI_API_KEY: este passo só existe para a ordem do Gemini.');
  const db = createDb(url, { max: 2 });
  const client = new WikimediaClient({ log });
  try {
    const { tables, release } = await loadF1dbForCommons(db);
    const targets = targetsByKey(
      tables,
      pending.map((e) => e.target),
    );
    const env = await panelEnv(db);
    // faixas da política de execução (#357): rodado à mão, desconta da faixa `manual`
    const budget = new TokenBudget(
      new PgTokenBudgetStore(db),
      ledgerPolicy(ledgerSettingsFromEnv(env), {
        policy: loadAiPolicyOrEmpty(defaultAiPolicyFile(env)),
        manual: isManualRun(env),
      }),
    );
    console.log(
      `${targets.length} alvo(s) a ordenar; F1DB ${release ?? '?'}; Gemini ${model}; ` +
        `IA ${budget.describe()} · agente ${ASSETS_AGENT}: ${budget.describe(ASSETS_AGENT)}`,
    );
    const { manifest, stats } = await mapCommons(client, targets, base, {
      revision: new Date().toISOString().slice(0, 10),
      ranker: geminiRanker({ apiKey, model, budget }),
      redo,
      log,
    });
    writeManifest(output, manifest);
    writeReport(output.replace(/\.yaml$/, '.cobertura.md'), coverageReport(manifest, stats));
    console.table(
      stats.map((s) => ({
        alvo: s.key,
        candidatas: s.candidates,
        aceitas: s.eligible,
        escolhidas: s.chosen,
        ordem: s.ranking,
      })),
    );
    console.log(`manifesto: ${output} · ${client.requests} requisições à Wikimedia`);
  } finally {
    await closeDb(db);
  }
}
