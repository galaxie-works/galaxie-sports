/**
 * Revisão das sugestões de edição em aberto na Revisão semântica (job `review-suggestions`, docs/06
 * §2.1): o modelo (Gemini por padrão) decide cada uma, a validação determinística confere, e o que for
 * aceito entra no ar na hora como edição no banco (semantic.review_override), sem deploy.
 *   pnpm --filter @galaxie/ai-agents review:suggestions --plan          # o que seria avaliado (sem LLM)
 *   pnpm --filter @galaxie/ai-agents review:suggestions                 # avalia e grava (até --max)
 *   pnpm --filter @galaxie/ai-agents review:suggestions --item copy:pt-BR.cheer-3
 *   pnpm --filter @galaxie/ai-agents review:suggestions --falso         # dev: provedor falso, sem chamada
 * Opções: --max N (padrão 10), --item <id> (repetível), --reavaliar (inclui as já recusadas).
 * O provedor sai de AI_REVIEW_PROVIDER (padrão gemini, com GEMINI_API_KEY) e AI_REVIEW_MODEL; o custo
 * vai para ops.llm_usage (agente `review`), dentro do AI_DAILY_TOKEN_BUDGET. A base lida é a de
 * KNOWLEDGE_DIR (padrão: data/knowledge do repositório). `--falso` aceita a edição proposta como veio
 * e recusa a sugestão sem edição: serve para conferir o fluxo e o painel no dev.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '@galaxie/knowledge';
import { reviewLlmEnv } from '../llm/config.js';
import { FakeLlmClient } from '../llm/fake.js';
import { createLlmClient } from '../llm/factory.js';
import type { LlmClient } from '../llm/types.js';
import { pendingSuggestions, SuggestionReviewer, type SuggestionOutcome } from '../review/run.js';
import type { ReviewModelOutput } from '../review/schema.js';
import { dbFromEnv, intFlag } from './common.js';

const LABEL: Record<SuggestionOutcome['outcome'], string> = {
  accepted: 'aprovada',
  adjusted: 'aprovada com ajustes',
  rejected: 'recusada',
  skipped: 'pulada',
  failed: 'falhou',
};

/** Provedor falso do dev: aceita a edição proposta como veio; sem edição, recusa. */
function fakeReviewer(): LlmClient {
  return new FakeLlmClient((req) => {
    const noEdit = req.messages[0]?.content.includes('Edição proposta: nenhuma');
    const data: ReviewModelOutput = noEdit
      ? {
          decision: 'reject',
          fields: [],
          reason: 'Provedor falso (dev): sugestão sem edição campo a campo.',
          adjustments: [],
        }
      : {
          decision: 'accept',
          fields: [],
          reason: 'Provedor falso (dev): edição aceita como veio.',
          adjustments: [],
        };
    return { data, model: 'fake-review' };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      max: { type: 'string' },
      item: { type: 'string', multiple: true },
      reavaliar: { type: 'boolean', default: false },
      falso: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const max = intFlag(values.max, 'max') ?? 10;
  const opts = {
    max,
    reevaluate: values.reavaliar,
    ...(values.item?.length ? { itemIds: values.item } : {}),
  };

  const db = dbFromEnv();
  try {
    const pending = await pendingSuggestions(db, opts);
    console.log(`Revisão de sugestões: ${pending.length} sugestão(ões) em aberto para avaliar (até ${max}).`);
    if (pending.length)
      console.table(
        pending.map((p) => ({
          item: p.id,
          titulo: p.title.slice(0, 40),
          por: p.suggestedBy ?? '',
          edicao: p.suggestion.fields ? Object.keys(p.suggestion.fields).join(', ') : '(só comentário)',
          comentario: p.suggestion.comment.slice(0, 60),
        })),
      );
    if (values.plan) {
      console.log('PRÉVIA: nada chamado, nada gravado.');
      return;
    }
    if (!pending.length) return;

    let llm: LlmClient;
    if (values.falso) {
      llm = fakeReviewer();
      console.log('Modelo: provedor falso (dev).');
    } else {
      try {
        const rt = createLlmClient({ db, env: reviewLlmEnv(process.env) });
        llm = rt.client;
        console.log(`Modelo: ${rt.settings.provider} · ${rt.settings.models.standard}`);
      } catch (err) {
        console.log(
          `LLM indisponível (${err instanceof Error ? err.message : String(err)}): nada avaliado. ` +
            'Configure AI_REVIEW_PROVIDER/GEMINI_API_KEY ou use --falso no dev.',
        );
        return;
      }
    }

    const dir = process.env.KNOWLEDGE_DIR ? resolve(process.env.KNOWLEDGE_DIR) : DEFAULT_KNOWLEDGE_DIR;
    const knowledge = await loadKnowledge(dir);
    const reviewer = new SuggestionReviewer({ db, llm, knowledge, log: (m) => console.log(`  ${m}`) });
    const outcomes = await reviewer.run(opts);
    let cost = 0;
    for (const o of outcomes) {
      cost += o.costUsd ?? 0;
      console.log(`${o.itemId}: ${LABEL[o.outcome]} — ${o.reason}`);
      for (const a of o.adjustments) console.log(`    ajuste: ${a}`);
      if (o.fields && o.outcome !== 'rejected')
        console.log(`    campos: ${Object.keys(o.fields).join(', ')}`);
    }
    const count = (k: SuggestionOutcome['outcome']) => outcomes.filter((o) => o.outcome === k).length;
    console.log(
      `${outcomes.length} avaliada(s): ${count('accepted') + count('adjusted')} aprovada(s) (no ar agora), ` +
        `${count('rejected')} recusada(s) (seguem "precisa de revisão"), ${count('skipped')} pulada(s), ` +
        `${count('failed')} com falha · US$ ${cost.toFixed(4)}.`,
    );
    if (count('failed')) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
