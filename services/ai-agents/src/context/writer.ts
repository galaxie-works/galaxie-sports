import {
  checkGeneratedText,
  describeViolations,
  joinSentences,
  type AgentLocale,
  type FactSheet,
  type Surface,
  type Violation,
} from '../guardrails/index.js';
import { BudgetExceededError } from '../llm/errors.js';
import type { BudgetNeed, LlmClient, LlmJsonRequest, LlmMessage, LlmTier, LlmUsage } from '../llm/types.js';

/**
 * Redação localizada com validação (docs/07 §2.3), comum ao Cenário e ao Resumo:
 * 1. uma chamada ao LLM redige todos os locales pedidos (saída JSON estruturada);
 * 2. cada locale passa pelos guardrails (fatos, termos, tamanho, idioma);
 * 3. os reprovados voltam ao LLM **uma** vez, com o motivo da reprovação;
 * 4. o que continuar reprovado (ou se o LLM falhar/estiver indisponível) usa o texto
 *    determinístico do agente — nunca se publica texto reprovado.
 */

export interface LocalizedWriteRequest {
  locales: readonly AgentLocale[];
  system: string;
  /** Mensagem com os fatos (JSON) e a tarefa para os locales informados. */
  userPrompt: (locales: readonly AgentLocale[]) => string;
  /** Fatos citáveis por locale (nomes localizados, rótulos fixos...). */
  factsFor: (locale: AgentLocale) => FactSheet;
  /** Texto determinístico (frases) do locale — usado quando o LLM não passa. */
  fallback: (locale: AgentLocale) => string[];
  surface: Surface;
  minSentences: number;
  maxSentences: number;
  llm: LlmClient | null;
  /** Identifica a tarefa no orçamento de tokens e nos logs (ex.: "context:scenario:<id>"). */
  purpose: string;
  tier?: LlmTier;
  maxOutputTokens?: number;
  /** Competição do evento: a faixa de orçamento da chamada sai da prioridade dela (#357). */
  competition?: LlmJsonRequest['competition'];
}

export interface RejectedAttempt {
  attempt: number;
  violations: Violation[];
}

export interface LocaleText {
  locale: AgentLocale;
  sentences: string[];
  text: string;
  origin: 'llm' | 'fallback';
  /** Tentativas do LLM consumidas por este locale (0 sem LLM). */
  attempts: number;
  rejected: RejectedAttempt[];
  /** Por que caiu no texto determinístico. */
  /**
   * `budget`: o orçamento recusou (faixa, agente ou global esgotado). Diferente de `llm_error`, não é
   * regerado a cada rodada com os mesmos fatos: só depois da virada do dia de orçamento.
   */
  fallbackReason?: 'no_llm' | 'llm_error' | 'budget' | 'rejected' | 'missing';
  /** O texto determinístico também passa pelos guardrails; violações aqui indicam bug do template. */
  fallbackViolations?: Violation[];
}

export interface LocalizedWriteResult {
  texts: LocaleText[];
  /** Modelo usado nas chamadas (null se nenhuma chamada teve sucesso). */
  model: string | null;
  usage: LlmUsage;
  llmCalls: number;
  errors: string[];
  /** O orçamento recusou (faixa, agente ou global esgotado, ou IA desligada): saiu o texto determinístico. */
  budgetSkipped: boolean;
  /** O que a chamada recusada pedia (para conferir, nas rodadas seguintes, se agora cabe). */
  budgetRefusal?: BudgetNeed;
}

/** Confiança gravada em enrich.event_context: aprovado de primeira 0,9; na 2ª 0,8; determinístico 1,0. */
export function confidenceOf(t: Pick<LocaleText, 'origin' | 'attempts'>): number {
  if (t.origin === 'fallback') return 1;
  return t.attempts <= 1 ? 0.9 : 0.8;
}

function outputSchema(locales: readonly AgentLocale[], min: number, max: number): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['texts'],
    properties: {
      texts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['locale', 'sentences'],
          properties: {
            locale: { type: 'string', enum: [...locales] },
            sentences: { type: 'array', minItems: min, maxItems: max, items: { type: 'string' } },
          },
        },
      },
    },
  };
}

/** Lê a saída do LLM sem confiar no formato (o schema é validado no cliente, mas conferimos de novo). */
function parseOutput(data: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const texts = (data as { texts?: unknown } | null)?.texts;
  if (!Array.isArray(texts)) return out;
  for (const item of texts) {
    const locale = (item as { locale?: unknown })?.locale;
    const sentences = (item as { sentences?: unknown })?.sentences;
    if (typeof locale !== 'string' || !Array.isArray(sentences)) continue;
    const clean = sentences.filter((s): s is string => typeof s === 'string').map((s) => s.trim());
    if (clean.length && !out.has(locale)) out.set(locale, clean.filter(Boolean));
  }
  return out;
}

const addUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => {
  const usage: LlmUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.costUsd !== undefined || b.costUsd !== undefined) usage.costUsd = (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return usage;
};

export async function writeLocalizedTexts(req: LocalizedWriteRequest): Promise<LocalizedWriteResult> {
  const result: LocalizedWriteResult = {
    texts: [],
    model: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    llmCalls: 0,
    errors: [],
    budgetSkipped: false,
  };
  const check = (locale: AgentLocale, sentences: string[]) =>
    checkGeneratedText(joinSentences(sentences), {
      locale,
      facts: req.factsFor(locale),
      surface: req.surface,
      minSentences: req.minSentences,
      maxSentences: req.maxSentences,
    });

  const accepted = new Map<AgentLocale, LocaleText>();
  const rejected = new Map<AgentLocale, RejectedAttempt[]>();
  const attempts = new Map<AgentLocale, number>();
  let pending: AgentLocale[] = [...req.locales];
  let llmFailed = false;
  let lastOutput: Map<string, string[]> | null = null;

  for (let attempt = 1; attempt <= 2 && pending.length && req.llm; attempt++) {
    const messages: LlmMessage[] = [{ role: 'user', content: req.userPrompt(pending) }];
    if (attempt === 2 && lastOutput) {
      const previous = pending.map((l) => ({ locale: l, sentences: lastOutput?.get(l) ?? [] }));
      messages.push({ role: 'assistant', content: JSON.stringify({ texts: previous }) });
      const feedback = pending.map((l) => {
        const reasons = describeViolations(rejected.get(l)?.at(-1)?.violations ?? []);
        return `- ${l}: ${reasons.length ? reasons.join('; ') : 'texto ausente'}`;
      });
      messages.push({
        role: 'user',
        content: [
          'Os textos abaixo foram reprovados pelo validador automático. Reescreva SOMENTE estes locales,',
          'corrigindo os problemas e usando apenas os fatos fornecidos:',
          ...feedback,
        ].join('\n'),
      });
    }
    for (const l of pending) attempts.set(l, (attempts.get(l) ?? 0) + 1);
    try {
      const res = await req.llm.generateJson<unknown>({
        tier: req.tier ?? 'standard',
        system: req.system,
        messages,
        schema: outputSchema(pending, req.minSentences, req.maxSentences),
        schemaName: 'localized_texts',
        purpose: `${req.purpose}:attempt${attempt}`,
        temperature: 0.3,
        maxOutputTokens: req.maxOutputTokens ?? 1500,
        ...(req.competition ? { competition: req.competition } : {}),
      });
      result.llmCalls++;
      result.model = res.model;
      result.usage = addUsage(result.usage, res.usage);
      lastOutput = parseOutput(res.data);
    } catch (err) {
      result.llmCalls++;
      result.errors.push(`tentativa ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      lastOutput = null;
      llmFailed = true;
      // falha de chamada também conta como tentativa: segue para a próxima (ou para o fallback)
      for (const l of pending) {
        const list = rejected.get(l) ?? [];
        list.push({ attempt, violations: [] });
        rejected.set(l, list);
      }
      // sem orçamento não adianta tentar de novo: a recusa vem antes do provedor, e o texto é o determinístico
      if (err instanceof BudgetExceededError && !err.midCall) {
        result.budgetSkipped = true;
        result.budgetRefusal = { unit: err.unit, requested: err.requested };
        break;
      }
      continue;
    }
    llmFailed = false;
    const still: AgentLocale[] = [];
    for (const locale of pending) {
      const sentences = lastOutput.get(locale);
      if (!sentences?.length) {
        const list = rejected.get(locale) ?? [];
        list.push({ attempt, violations: [{ kind: 'empty', value: 'locale ausente na resposta' }] });
        rejected.set(locale, list);
        still.push(locale);
        continue;
      }
      const violations = check(locale, sentences);
      if (violations.length === 0) {
        accepted.set(locale, {
          locale,
          sentences,
          text: joinSentences(sentences),
          origin: 'llm',
          attempts: attempts.get(locale) ?? attempt,
          rejected: rejected.get(locale) ?? [],
        });
      } else {
        const list = rejected.get(locale) ?? [];
        list.push({ attempt, violations });
        rejected.set(locale, list);
        still.push(locale);
      }
    }
    pending = still;
  }

  for (const locale of req.locales) {
    const ok = accepted.get(locale);
    if (ok) {
      result.texts.push(ok);
      continue;
    }
    const sentences = req.fallback(locale);
    const text = joinSentences(sentences);
    const history = rejected.get(locale) ?? [];
    const reason: LocaleText['fallbackReason'] = !req.llm
      ? 'no_llm'
      : result.budgetSkipped
        ? 'budget'
        : // a última chamada falhou e nenhuma tentativa reprovou o texto (só faltou o locale): é erro do LLM
          llmFailed && history.every((h) => h.violations.every((v) => v.kind === 'empty'))
          ? 'llm_error'
          : history.some((h) => h.violations.some((v) => v.kind !== 'empty'))
            ? 'rejected'
            : 'missing';
    const fallbackViolations = check(locale, sentences).filter(
      // o texto determinístico pode passar do limite de frases/tamanho; o resto é bug do template
      (v) => !['too_long', 'sentence_too_long', 'too_many_sentences'].includes(v.kind),
    );
    const item: LocaleText = {
      locale,
      sentences,
      text,
      origin: 'fallback',
      attempts: attempts.get(locale) ?? 0,
      rejected: history,
      fallbackReason: reason,
    };
    if (fallbackViolations.length) item.fallbackViolations = fallbackViolations;
    result.texts.push(item);
  }
  return result;
}
