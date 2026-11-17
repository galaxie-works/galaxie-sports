/**
 * Casamento da lista de canais do cliente: a IA confere só as sobras do código (job `channel-lists`,
 * docs/07 §2.2.3). Roda na VPS com o Gemini; no dev, use o provedor falso.
 *   pnpm --filter @galaxie/ai-agents channels:match --plan       # o que seria enviado (sem LLM)
 *   pnpm --filter @galaxie/ai-agents channels:match              # confere e grava (até --max listas)
 *   pnpm --filter @galaxie/ai-agents channels:match --falso      # dev: provedor falso, sem chamada
 * Opções: --max N (padrão 10), --tenant <id> (repetível), --repetir-falhas (inclui as que falharam).
 * O provedor sai de AI_CHANNELS_PROVIDER (padrão gemini, com GEMINI_API_KEY) e AI_CHANNELS_MODEL; o
 * custo vai para ops.llm_usage, dentro do AI_DAILY_TOKEN_BUDGET. O falso responde
 * `sem_canal_na_lista` para todo direito: serve para conferir o fluxo e o portal no dev.
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db/client';
import type { ChannelMatchOutput } from '@galaxie/where-to-watch';
// só o necessário para saber se há lista pendente; o Onde Assistir, o modelo e o casamento vêm depois (import
// dinâmico), e a execução sem trabalho sai sem carregá-los
import { pendingChannelLists } from '../channels/pending.js';
import type { LlmClient } from '../llm/types.js';
import { dbFromEnv, intFlag } from './light.js';

/** Provedor falso do dev: nenhum canal para as sobras (o que o validador sempre aceita). */
async function fakeMatcher(): Promise<LlmClient> {
  const { FakeLlmClient } = await import('../llm/fake.js');
  return new FakeLlmClient((req) => {
    // direitos numerados da mensagem ("0: país ... | plataforma_id ...")
    const count = req.messages[0]!.content.match(/^\d+: país /gm)?.length ?? 0;
    const data: ChannelMatchOutput = {
      transmissores: Array.from({ length: count }, (_, i) => ({
        direito_idx: i,
        canal_cliente_idx: null,
        casamento: 'sem_canal_na_lista',
        nota_auditoria: null,
      })),
    };
    return { data, model: 'fake-channels' };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      max: { type: 'string' },
      tenant: { type: 'string', multiple: true },
      'repetir-falhas': { type: 'boolean', default: false },
      falso: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const opts = {
    max: intFlag(values.max, 'max') ?? 10,
    retryFailed: values['repetir-falhas'],
    ...(values.tenant?.length ? { tenantIds: values.tenant } : {}),
  };
  const db = dbFromEnv();
  try {
    const pending = await pendingChannelLists(db, opts);
    console.log(`Listas de canais com sobras para a IA: ${pending.length} (até ${opts.max}).`);
    if (!pending.length && !values.plan) return;
    const [{ ChannelDictionary, loadWtwConfig, processChannelList }, { processInputOf, runChannelLists }] =
      await Promise.all([import('@galaxie/where-to-watch'), import('../channels/run.js')]);
    const config = loadWtwConfig();
    if (values.plan) {
      const dict = new ChannelDictionary(config);
      for (const row of pending) {
        const res = await processChannelList(processInputOf(row, config, dict));
        console.log(
          `  ${row.tenantId}: ${row.channels.length} canais, ${res.batches.length} pedido(s) — ` +
            res.batches
              .map((b) => `${b.country} ${b.rights.length} direito(s) × ${b.channels.length} canal(is)`)
              .join(', '),
        );
      }
      console.log('PRÉVIA: nada chamado, nada gravado.');
      return;
    }
    let llm: LlmClient;
    if (values.falso) {
      llm = await fakeMatcher();
      console.log('Modelo: provedor falso (dev).');
    } else {
      try {
        const [{ createAgentLlm }, { channelsLlmEnv }] = await Promise.all([
          import('./common.js'),
          import('../llm/config.js'),
        ]);
        const rt = await createAgentLlm(db, 'channels', channelsLlmEnv);
        llm = rt.client;
        console.log(`Modelo: ${rt.settings.provider} · ${rt.settings.models.standard}`);
      } catch (err) {
        console.log(
          `LLM indisponível (${err instanceof Error ? err.message : String(err)}): nada conferido. ` +
            'Configure AI_CHANNELS_PROVIDER/GEMINI_API_KEY ou use --falso no dev.',
        );
        return;
      }
    }
    const outcomes = await runChannelLists({ db, llm, config, ...opts, log: (m) => console.log(`  ${m}`) });
    const cost = outcomes.reduce((n, o) => n + (o.costUsd ?? 0), 0);
    console.log(
      `Concluído: ${outcomes.filter((o) => o.outcome === 'done').length} gravada(s), ` +
        `${outcomes.filter((o) => o.outcome === 'partial').length} em parte (pedidos acima do teto ficam para a próxima rodada), ` +
        `${outcomes.filter((o) => o.outcome === 'failed').length} com falha · custo estimado US$ ${cost.toFixed(4)}`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
