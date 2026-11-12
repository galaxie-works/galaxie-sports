/**
 * Preparo de uma pergunta ao assistente da Cosmos (#1003), só no servidor: valida a entrada, busca na
 * documentação, monta o prompt e estima os créditos. A rota em fluxo e a estimativa da tela usam o mesmo preparo,
 * então o "cerca de N créditos" mostrado antes é o mesmo que a reserva pede.
 */
import { inflateSync } from 'node:zlib';

import {
  activeFunction,
  ASSISTANT_ATTACHMENT_LIMITS,
  ASSISTANT_FILE_PROVIDERS,
  ASSISTANT_STREAMERS,
  type AttachmentError,
  type AttachmentMeta,
  checkAttachments,
  type PromptAttachment,
  readAttachment,
  type AssistantStreamer,
  cosmosApiKey,
  type CosmosProvider,
  ASSISTANT_FUNCTION,
  buildPrompt,
  DOCS_BUDGET_CHARS,
  estimateAssistantCredits,
  getWallet,
  embeddingClientFor,
  readCosmosSettings,
  readEmbeddingsSetting,
  searchKnowledge,
  type ChatTurn,
  type DocChunk,
  type CosmosSettings,
  type ScreenContext,
  verifiedHistory,
} from '@galaxie/cosmos';
import type { Actor } from '@galaxie/engage';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/config';

import { openApiDocument } from '@/lib/openapi-reference';

import { apiChunks, docChunks } from './assistant-docs';

/** Trechos por idioma (guias no idioma da tela e o contrato da API), montados uma vez por processo. */
const corpus = new Map<Locale, DocChunk[]>();
function knowledgeFor(locale: Locale): DocChunk[] {
  let chunks = corpus.get(locale);
  if (!chunks) {
    chunks = [...docChunks(getDictionary(locale).docs), ...apiChunks(openApiDocument())];
    corpus.set(locale, chunks);
  }
  return chunks;
}

export const QUESTION_MAX = 2000;
const VISIBLE_MAX = 6000;
const HISTORY_MAX = 8;
const TURN_MAX = 4000;

export interface AssistantRequest {
  question: string;
  context: ScreenContext;
  /** Respostas vêm com a assinatura do servidor; sem ela, não entram no prompt (`verifiedHistory`). */
  history: (ChatTurn & { sig?: string })[];
}

/** Base64 que cabe no maior anexo (4 caracteres a cada 3 bytes), conferido antes de decodificar. */
const MAX_BASE64 =
  Math.ceil(
    (Math.max(ASSISTANT_ATTACHMENT_LIMITS.maxImageBytes, ASSISTANT_ATTACHMENT_LIMITS.maxPdfBytes) * 4) / 3,
  ) + 4;

/** Teto do que um fluxo do PDF pode virar ao descomprimir (um arquivo-bomba não enche a memória). */
const INFLATE_MAX_BYTES = 16_000_000;
const pdfInflate = (data: Uint8Array) =>
  new Uint8Array(inflateSync(data, { maxOutputLength: INFLATE_MAX_BYTES }));

/** Corpo da pergunta: os anexos em base64 e uma folga para a pergunta, a tela e o histórico. */
export const REQUEST_MAX_BYTES = Math.ceil((ASSISTANT_ATTACHMENT_LIMITS.maxTotalBytes * 4) / 3) + 200_000;

/**
 * Anexos da pergunta como o navegador manda (`[{ name, data }]`, data em base64): cada um é lido pelos bytes e
 * conferido contra os limites antes de qualquer reserva (#1065). O conteúdo fica só na memória desta pergunta.
 */
export function parseAttachmentFiles(
  raw: unknown,
): { ok: true; files: PromptAttachment[] } | { ok: false; error: AttachmentError } {
  if (raw === undefined || raw === null) return { ok: true, files: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'type' };
  if (raw.length > ASSISTANT_ATTACHMENT_LIMITS.maxFiles) return { ok: false, error: 'count' };
  const files: PromptAttachment[] = [];
  for (const item of raw) {
    const name = typeof item?.name === 'string' ? item.name : '';
    const data = typeof item?.data === 'string' ? item.data : '';
    if (!data) return { ok: false, error: 'type' };
    if (data.length > MAX_BASE64) return { ok: false, error: 'size' };
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return { ok: false, error: 'type' };
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    const read = readAttachment(name, bytes, { inflate: pdfInflate });
    if (!read.ok) return read;
    // texto vai na pergunta; imagem e PDF seguem em base64 refeito aqui (o do navegador pode vir sem o padding)
    files.push(
      read.file.kind === 'text' ? read.file : { ...read.file, data: Buffer.from(bytes).toString('base64') },
    );
  }
  const total = checkAttachments(files);
  return total ? { ok: false, error: total } : { ok: true, files };
}

/** Lê e corta a entrada do navegador (nada passa do tamanho combinado; o resto é descartado). */
export function parseAssistantRequest(body: unknown): AssistantRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question || question.length > QUESTION_MAX) return null;
  const c = (b.context ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const destinations = Array.isArray(c.destinations)
    ? c.destinations
        .filter(
          (d): d is { label: string; href: string } =>
            typeof d?.label === 'string' && typeof d?.href === 'string',
        )
        .filter((d) => d.href.startsWith('/'))
        .slice(0, 20)
        .map((d) => ({ label: d.label.slice(0, 80), href: d.href.slice(0, 200) }))
    : [];
  const history = Array.isArray(b.history)
    ? b.history
        .filter(
          (t): t is ChatTurn =>
            (t?.role === 'user' || t?.role === 'assistant') &&
            typeof t?.text === 'string' &&
            t.text.trim() !== '',
        )
        .slice(-HISTORY_MAX)
        .map((t) => {
          const sig = (t as { sig?: unknown }).sig;
          // a resposta vai inteira (a assinatura é do texto exato); a pergunta é cortada
          return t.role === 'assistant'
            ? { role: t.role, text: t.text, ...(typeof sig === 'string' ? { sig: sig.slice(0, 100) } : {}) }
            : { role: t.role, text: t.text.slice(0, TURN_MAX) };
        })
        .filter((t) => t.text.length <= TURN_MAX * 4)
    : [];
  return {
    question,
    context: {
      route: str(c.route, 200) || '/',
      title: str(c.title, 200),
      visible: str(c.visible, VISIBLE_MAX),
      destinations,
    },
    history,
  };
}

export interface PreparedQuestion {
  prompt: ReturnType<typeof buildPrompt>;
  credits: number;
  settings: CosmosSettings;
  /** Provedor e modelo da função no catálogo (#1088). */
  provider: CosmosProvider;
  model: string;
  /** Chamada ao provedor da função, já com a chave da Cosmos nele. */
  streamer: AssistantStreamer;
  apiKey: string;
  /** Tipo e tamanho dos anexos, para a última trava antes da reserva e o extrato. */
  attachments: AttachmentMeta[];
}

/** Moldura da documentação no prompt (`<documentacao>` e as quebras de linha), contada junto com o orçamento. */
const DOCS_FRAME_CHARS = 40;

/**
 * Monta o prompt e a estimativa no preço do modelo da função; null quando o assistente está indisponível: função
 * fora do catálogo ou desligada, provedor que o assistente ainda não chama, ou sem a chave da Cosmos nele.
 *
 * Os créditos contam o orçamento inteiro da documentação, não os trechos achados: a estimativa da tela (`semantic`
 * desligado, só busca por palavras, sem chamar provedor) e a pergunta de verdade (com a busca por significado)
 * pedem o mesmo número.
 */
export async function prepareQuestion(
  scope: { tenantId: string; userId: string },
  req: AssistantRequest,
  locale: Locale,
  options: {
    semantic?: boolean;
    signal?: AbortSignal;
    /** Anexos lidos (a pergunta de verdade). */
    files?: readonly PromptAttachment[];
    /** Só o tipo e o tamanho (a estimativa da tela, que não manda o conteúdo). */
    metas?: readonly AttachmentMeta[];
  } = {},
): Promise<PreparedQuestion | 'attachment_unsupported' | null> {
  const tenantId = scope.tenantId;
  const db = builderDb();
  const [settings, fn, wallet, embeddings] = await Promise.all([
    readCosmosSettings(db),
    activeFunction(db, ASSISTANT_FUNCTION),
    getWallet(db, tenantId),
    readEmbeddingsSetting(db),
  ]);
  if (!fn) return null;
  const streamer = ASSISTANT_STREAMERS[fn.provider];
  const apiKey = assistantApiKey(fn.provider);
  if (!streamer || !apiKey) return null;
  const files = options.files ?? [];
  const metas: AttachmentMeta[] = (options.files ?? options.metas ?? []).map((f) => ({
    kind: f.kind,
    bytes: f.bytes,
    ...(f.pages ? { pages: f.pages } : {}),
  }));
  if (metas.some((m) => m.kind !== 'text') && !ASSISTANT_FILE_PROVIDERS.includes(fn.provider))
    return 'attachment_unsupported';
  const docs = await searchKnowledge(req.question, knowledgeFor(locale), {
    db,
    client: options.semantic ? embeddingClientFor(embeddings, process.env, { preferred: fn.provider }) : null,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const history = verifiedHistory(req.history, assistantSigningKey(), scope);
  const input = { question: req.question, context: req.context, history, locale };
  const prompt = buildPrompt({ ...input, docs, attachments: files });
  // a estimativa conta os anexos pelo tipo e tamanho (o que a tela também sabe), não pelo conteúdo
  const withoutDocs = buildPrompt({ ...input, docs: [] });
  const credits = estimateAssistantCredits({
    system: withoutDocs.system,
    extraInputChars: DOCS_BUDGET_CHARS + DOCS_FRAME_CHARS,
    messages: withoutDocs.messages,
    attachments: metas,
    question: req.question,
    creditUsd: settings.creditUsd,
    multiplier: wallet?.multiplier ?? 1,
    minCredits: fn.minCredits,
    model: fn.model,
  });
  return {
    prompt,
    credits,
    settings,
    provider: fn.provider,
    model: fn.model,
    streamer,
    apiKey,
    attachments: metas,
  };
}

/** Chave que assina as respostas do histórico (a mesma da sessão); sem ela, respostas antigas não voltam ao prompt. */
export function assistantSigningKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.BETTER_AUTH_SECRET?.trim() || null;
}

/**
 * Quem pode perguntar: o cliente do próprio tenant, com o módulo Cosmos AI no contrato e cargo que abre
 * `cosmos.assistant.ask` (#996; voluntário não). A equipe Galaxie também pergunta, em qualquer tenant em foco, mas sem
 * gastar os créditos dele: a rota usa `askAssistantAsStaff`, e o custo fica em `cosmos.staff_usage`.
 */
export function assistantAccessError(ctx: {
  role: 'admin' | 'client';
  tenant: { id: string; modules: readonly string[] } | null;
  actor: Actor | null;
}): 'unauthorized' | 'staff' | 'module' | 'role' | null {
  if (!ctx.tenant) return 'unauthorized';
  if (ctx.role === 'admin') return null;
  if (!ctx.tenant.modules.includes('cosmos_ai')) return 'module';
  if (!can(ctx, 'cosmos.assistant.ask')) return 'role';
  return null;
}

/**
 * Chave da Cosmos no provedor (COSMOS_<PROVEDOR>_API_KEY, separada das chaves da IA interna); vazia = o assistente
 * fica indisponível enquanto a função usar esse provedor.
 */
export function assistantApiKey(
  provider: CosmosProvider,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return cosmosApiKey(provider, env);
}
