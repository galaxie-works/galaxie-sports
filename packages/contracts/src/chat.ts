import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Chat ao vivo (Sala do Jogo, épico #915, #959): uma sala por jogo e por cliente. Ler a sala usa a chave do cliente
 * (secreta no servidor, publicável no navegador) e não exige login; enviar exige o token `gft_` de um torcedor
 * `18plus`. As mensagens chegam às telas em lotes pelo canal ao vivo (#964).
 */

export const CHAT_ROOM_STATES = ['scheduled', 'open', 'frozen', 'read_only_peak', 'closed'] as const;
export const CHAT_STRICTNESS_VALUES = ['standard', 'strict'] as const;
export const CHAT_SEND_REFUSALS = [
  'age_band',
  'room_scheduled',
  'room_frozen',
  'room_closed',
  'room_read_only_peak',
  'sanctioned',
] as const;

export const ChatRoomParams = z.object({
  fixtureId: z.uuid().meta({ description: 'ID do jogo (o mesmo de /v1/events/{id}).' }),
});
export type ChatRoomParams = z.infer<typeof ChatRoomParams>;

export const ChatAuthor = z
  .object({
    profile_id: z.uuid().meta({ description: 'Id opaco do Perfil (nunca o id do cliente).' }),
    nickname: z.string().nullable(),
    avatar_url: z.string().nullable().meta({ description: 'null quando o torcedor esconde o avatar.' }),
  })
  .meta({ id: 'ChatAuthor' });

export const ChatMessage = z
  .object({
    id: z.uuid(),
    body: z.string(),
    author: ChatAuthor,
    created_at: z.string(),
  })
  .meta({ id: 'ChatMessage' });
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRoomSettings = z
  .object({
    slow_mode_seconds: z
      .number()
      .int()
      .meta({ description: 'Segundos entre mensagens do mesmo torcedor; 0 = livre.' }),
    strictness: z.enum(CHAT_STRICTNESS_VALUES),
    max_chars: z.number().int(),
  })
  .meta({ id: 'ChatRoomSettings' });

export const ChatRoom = z
  .object({
    data: z.object({
      room_id: z.uuid(),
      fixture_id: z.uuid(),
      state: z.enum(CHAT_ROOM_STATES).meta({
        description:
          '`scheduled`: ainda não abriu; `open`: aberta; `frozen`: congelada pela moderação (só leitura); ' +
          '`read_only_peak`: só leitura para quem entra, pico do plano estourado; `closed`: encerrada (só leitura).',
      }),
      opens_at: z.string(),
      closes_at: z.string(),
      settings: ChatRoomSettings,
      messages: z
        .array(ChatMessage)
        .meta({ description: 'Últimas mensagens, da mais antiga para a mais nova.' }),
    }),
  })
  .meta({ id: 'ChatRoom' });
export type ChatRoom = z.infer<typeof ChatRoom>;

export const ChatMessageBody = z
  .strictObject({
    body: z.string().meta({ description: 'Texto e emoji. O tamanho máximo vem de `settings.max_chars`.' }),
  })
  .meta({ id: 'ChatMessageBody' });
export type ChatMessageBody = z.infer<typeof ChatMessageBody>;

export const ChatMessageResponse = z
  .object({
    data: ChatMessage.extend({
      status: z.enum(['published', 'held']).meta({
        description:
          '`published`: entra no próximo lote da sala. `held`: só o autor vê (a moderação decide). O autor não ' +
          'precisa tratar diferente: a mensagem aparece para ele nos dois casos.',
      }),
    }),
  })
  .meta({ id: 'ChatMessageResponse' });
export type ChatMessageResponse = z.infer<typeof ChatMessageResponse>;

/** Ajuste de uma sala pelo servidor do cliente (chave secreta). `null` volta ao padrão do cliente. */
export const ChatRoomPatchBody = z
  .strictObject({
    state: z.enum(['open', 'frozen']).optional(),
    slowModeSeconds: z.number().int().min(0).max(600).nullable().optional(),
    strictness: z.enum(CHAT_STRICTNESS_VALUES).nullable().optional(),
  })
  .meta({ id: 'ChatRoomPatchBody' });
export type ChatRoomPatchBody = z.infer<typeof ChatRoomPatchBody>;

/** Padrão do cliente para todas as salas (chave secreta). `null` volta ao padrão da Galaxie. */
export const ChatConfigBody = z
  .strictObject({
    openBeforeMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    closeAfterMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    slowModeSeconds: z.number().int().min(0).max(600).nullable().optional(),
    strictness: z.enum(CHAT_STRICTNESS_VALUES).nullable().optional(),
  })
  .meta({ id: 'ChatConfigBody' });
export type ChatConfigBody = z.infer<typeof ChatConfigBody>;

export const ChatConfig = z
  .object({
    data: z.object({
      open_before_minutes: z.number().int(),
      close_after_minutes: z.number().int(),
      slow_mode_seconds: z.number().int(),
      strictness: z.enum(CHAT_STRICTNESS_VALUES),
      custom: z
        .array(z.string())
        .meta({ description: 'Campos com valor próprio do cliente (o resto é padrão).' }),
    }),
  })
  .meta({ id: 'ChatConfig' });
export type ChatConfig = z.infer<typeof ChatConfig>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Chat ao vivo';
const fanAuth = [{ galaxieFanToken: [] }];
const keyErrors = {
  '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
  '403': problem('Módulo live_chat fora do plano (MODULE_NOT_IN_PLAN)'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};

/** Paths do Chat ao vivo para o documento OpenAPI. */
export const chatPaths: ZodOpenApiPathsObject = {
  '/v1/chat/rooms/{fixtureId}': {
    get: {
      summary: 'Estado da Sala do Jogo e últimas mensagens',
      description:
        'Cria a sala no primeiro acesso ao jogo. Ler não exige login: no navegador use a chave publicável. A sala ' +
        'abre antes do início e fecha depois do fim, pela janela do cliente. Mensagens de Perfis excluídos e as ' +
        'retidas pela moderação não aparecem. Exige o módulo `live_chat`.',
      tags: [TAG],
      requestParams: { path: ChatRoomParams },
      responses: {
        '200': { description: 'OK', content: json(ChatRoom) },
        '404': problem('Jogo não encontrado (NOT_FOUND)'),
        ...keyErrors,
      },
    },
    patch: {
      summary: 'Congela, reabre ou ajusta uma sala',
      description:
        'Chamado pelo servidor do cliente, com a chave secreta. Congelar deixa a sala só leitura até reabrir. ' +
        'Modo lento e rigor valem só para esta sala; `null` volta ao padrão do cliente.',
      tags: [TAG],
      requestParams: { path: ChatRoomParams },
      requestBody: { content: json(ChatRoomPatchBody) },
      responses: {
        '200': { description: 'Sala ajustada', content: json(ChatRoom) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        '404': problem('Jogo não encontrado (NOT_FOUND)'),
        ...keyErrors,
      },
    },
  },
  '/v1/chat/rooms/{fixtureId}/messages': {
    post: {
      summary: 'Envia uma mensagem',
      description:
        'Só torcedor `18plus` escreve; `13_17` lê e reage (403 FAN_AGE_RESTRICTED). A mensagem passa pela base de ' +
        'regras de moderação antes de entrar no lote da sala. Sala congelada, encerrada, ainda fechada ou só ' +
        'leitura por pico responde 409; o motivo vai em `errors` (`path: refusal`, um de CHAT_SEND_REFUSALS). Modo lento: 429 com Retry-After.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: ChatRoomParams },
      requestBody: { content: json(ChatMessageBody) },
      responses: {
        '201': { description: 'Mensagem aceita', content: json(ChatMessageResponse) },
        '400': problem('Mensagem vazia, longa demais ou recusada pelas regras (INVALID_PARAMS)'),
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '403': problem('Faixa etária (FAN_AGE_RESTRICTED) ou módulo fora do plano (MODULE_NOT_IN_PLAN)'),
        '404': problem('Jogo não encontrado (NOT_FOUND)'),
        '409': problem('Sala fechada para envio ou punição ativa (CONFLICT; motivo em `errors`)'),
        '429': problem('Modo lento ou limite do torcedor (RATE_LIMITED)'),
        '503': problem('Ficha do país não configurada para o cliente (DEGRADED)'),
      },
    },
  },
  '/v1/chat/rooms/{fixtureId}/stream': {
    get: {
      summary: 'Mensagens da sala em lotes (SSE)',
      description:
        'Server-Sent Events. Um evento `chat.batch` por lote (no máximo um por segundo), com `id:` = número do ' +
        'lote e `data: {"batch_id", "messages": [ChatMessage]}`. Ao abrir vem `chat.state` (estado da sala; ' +
        '`read_only_peak` quando a faixa de conexões do cliente estourou) e `ready` com `last_batch_id`. ' +
        'Reconexão: `Last-Event-ID` (ou `?last_batch_id=`) reenvia os lotes perdidos do histórico curto; se o ' +
        'buraco saiu dele, vem `chat.reset` e o cliente relê a sala pelo GET. No navegador use um cliente SSE sobre ' +
        '`fetch` com a chave publicável no header (a chave nunca vai na URL). Exige o módulo `live_chat`.',
      tags: [TAG],
      requestParams: {
        path: ChatRoomParams,
        query: z.object({ last_batch_id: z.number().int().min(0).optional() }),
      },
      responses: {
        '200': {
          description: 'Stream SSE (text/event-stream)',
          content: { 'text/event-stream': { schema: z.string() } },
        },
        '404': problem('Jogo não encontrado (NOT_FOUND)'),
        ...keyErrors,
        '503': problem('Limite de conexões da instância (DEGRADED), com Retry-After'),
      },
    },
  },
  '/v1/chat/config': {
    get: {
      summary: 'Padrão do cliente para as salas',
      tags: [TAG],
      security: [{ galaxieKey: [] }],
      responses: { '200': { description: 'OK', content: json(ChatConfig) }, ...keyErrors },
    },
    put: {
      summary: 'Muda o padrão do cliente para as salas',
      description:
        'Janela de abertura e encerramento, modo lento e rigor, dentro do teto da Galaxie. `null` volta ao padrão ' +
        'da Galaxie. Chave secreta.',
      tags: [TAG],
      requestBody: { content: json(ChatConfigBody) },
      responses: {
        '200': { description: 'OK', content: json(ChatConfig) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        ...keyErrors,
      },
    },
  },
};
