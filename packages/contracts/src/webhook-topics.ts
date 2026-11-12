/**
 * Registro central dos tópicos de webhook (#1023): o único lugar onde um tópico nasce. Cada tópico declara o módulo
 * que o libera, o payload documentado (Zod, que também gera a seção `webhooks` do OpenAPI) e se já é emitido.
 *
 * Convenção: `modulo.entidade.acao`, em snake_case, com o prefixo do módulo (`chat`, `community`, `game`, `shop`,
 * `cosmos`) ou `fan` para a identidade do torcedor, que vale para qualquer módulo de engajamento. Os seis tópicos
 * de dados que já eram públicos antes do registro (`event.score_changed`...) ficam com o nome que têm: clientes já
 * assinam por esse nome. Nenhum tópico novo entra fora da convenção (teste em `webhook-topics.test.ts`).
 *
 * Payload de engajamento nunca leva e-mail, documento, telefone ou nome do torcedor: só o `profile_id` opaco. O
 * worker passa o payload pelo schema antes de enfileirar, então um campo que não está declarado aqui não sai.
 */
import * as z from 'zod';
import { CHANGE_TOPICS, RealtimeChange, type ChangeTopic } from './realtime.js';

/** Módulos do tenant que liberam tópicos (os ids de `API_MODULES` em `@galaxie/db`; conferidos no teste da API). */
export const WEBHOOK_DATA_MODULES = [
  'core_data',
  'where_to_watch',
  'live_intelligence',
  'related_content',
] as const;
export const WEBHOOK_ENGAGE_MODULES = [
  'live_chat',
  'communities',
  'gamification',
  'shopping',
  'cosmos_ai',
] as const;
export type WebhookModule = (typeof WEBHOOK_DATA_MODULES)[number] | (typeof WEBHOOK_ENGAGE_MODULES)[number];

/** Prefixo do tópico → módulo exigido. `fan` vale para qualquer módulo de engajamento ligado. */
export const WEBHOOK_TOPIC_PREFIXES = {
  chat: ['live_chat'],
  community: ['communities'],
  game: ['gamification'],
  shop: ['shopping'],
  cosmos: ['cosmos_ai'],
  fan: WEBHOOK_ENGAGE_MODULES,
} as const satisfies Record<string, readonly WebhookModule[]>;
export type WebhookTopicPrefix = keyof typeof WEBHOOK_TOPIC_PREFIXES;

/** `modulo.entidade.acao`: três partes em snake_case. O prefixo é conferido à parte (`WEBHOOK_TOPIC_PREFIXES`). */
export const WEBHOOK_TOPIC_PATTERN = /^[a-z]+\.[a-z]+(?:_[a-z]+)*\.[a-z]+(?:_[a-z]+)*$/;

/** Tópicos públicos anteriores ao registro, aceitos fora da convenção. A lista é fechada: não cresce. */
export const LEGACY_WEBHOOK_TOPICS: readonly ChangeTopic[] = CHANGE_TOPICS;

type Labels = { pt: string; es: string; en: string };

export interface WebhookTopicDef {
  topic: string;
  /** O tópico aparece e dispara se o tenant tem pelo menos um destes módulos ligado. */
  modules: readonly WebhookModule[];
  /**
   * `live`: já é emitido e o cliente pode assinar no portal. `planned`: documentado, mas o módulo ainda não
   * emite; não aparece no portal nem entra no "todos os tópicos" de um webhook.
   */
  status: 'live' | 'planned';
  /** Nome curto na tela do cliente (Integrações → Webhooks). */
  label: Labels;
  /** Quando dispara (vai para a documentação da API). */
  description: string;
  /** Corpo do POST. */
  payload: z.ZodType;
}

/** Id opaco do Perfil do torcedor: o `profile_id` do token. Nunca e-mail, documento, telefone ou nome. */
const profileId = z
  .uuid()
  .meta({
    description: 'Id opaco do Perfil do torcedor (o `profile_id` do token). Nunca e-mail nem documento.',
  });

/** Corpo comum dos tópicos de engajamento. */
function engageEnvelope<T extends z.ZodRawShape>(id: string, topic: string, data: T) {
  return z
    .object({
      id: z.string().meta({ description: 'Id da entrega (monotônico).', example: '1042' }),
      topic: z.literal(topic),
      occurred_at: z.iso.datetime(),
      data: z.object(data),
    })
    .meta({ id });
}

const ENGAGE_TOPICS: WebhookTopicDef[] = [
  {
    topic: 'chat.room.opened',
    modules: WEBHOOK_TOPIC_PREFIXES.chat,
    status: 'planned',
    label: { pt: 'Sala do jogo aberta', es: 'Sala del partido abierta', en: 'Match room opened' },
    description: 'A Sala do Jogo de um evento abriu para os torcedores.',
    payload: engageEnvelope('WebhookChatRoomOpened', 'chat.room.opened', {
      room_id: z.uuid(),
      event_id: z.uuid().nullable().meta({ description: 'Evento da sala; `null` em sala sem jogo.' }),
    }),
  },
  {
    topic: 'community.campaign.closed',
    modules: WEBHOOK_TOPIC_PREFIXES.community,
    status: 'planned',
    label: { pt: 'Campanha encerrada', es: 'Campaña cerrada', en: 'Campaign closed' },
    description: 'Uma campanha de uma Comunidade terminou; o resultado já pode ser lido na API.',
    payload: engageEnvelope('WebhookCommunityCampaignClosed', 'community.campaign.closed', {
      community_id: z.uuid(),
      campaign_id: z.uuid(),
      participants: z.number().int().nonnegative().meta({ description: 'Perfis que participaram.' }),
    }),
  },
  {
    topic: 'game.achievement.level_reached',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'planned',
    label: {
      pt: 'Nível de conquista atingido',
      es: 'Nivel de logro alcanzado',
      en: 'Achievement level reached',
    },
    description: 'Um torcedor subiu de nível numa conquista do programa de Gamificação.',
    payload: engageEnvelope('WebhookGameAchievementLevelReached', 'game.achievement.level_reached', {
      profile_id: profileId,
      program_id: z.uuid(),
      achievement_id: z.uuid(),
      level: z.number().int().positive(),
    }),
  },
  {
    topic: 'game.points.expiring',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'planned',
    label: { pt: 'Pontos a vencer', es: 'Puntos por vencer', en: 'Points expiring' },
    description: 'Parte do saldo de pontos de um torcedor vence em breve.',
    payload: engageEnvelope('WebhookGamePointsExpiring', 'game.points.expiring', {
      profile_id: profileId,
      program_id: z.uuid(),
      points: z.number().int().positive(),
      expires_at: z.iso.datetime(),
    }),
  },
  {
    topic: 'shop.click.registered',
    modules: WEBHOOK_TOPIC_PREFIXES.shop,
    status: 'planned',
    label: { pt: 'Clique de compra', es: 'Clic de compra', en: 'Shop click' },
    description: 'Um clique de saída para uma oferta foi registrado. Não identifica o torcedor.',
    payload: engageEnvelope('WebhookShopClickRegistered', 'shop.click.registered', {
      click_id: z.uuid(),
      offer_id: z.uuid(),
      event_id: z.uuid().nullable(),
      country: z.string().length(2).meta({ example: 'BR' }),
    }),
  },
  {
    topic: 'cosmos.balance.low',
    modules: WEBHOOK_TOPIC_PREFIXES.cosmos,
    status: 'planned',
    label: { pt: 'Saldo da Cosmos AI baixo', es: 'Saldo de Cosmos AI bajo', en: 'Cosmos AI balance low' },
    description: 'O saldo de créditos da Cosmos AI do tenant ficou abaixo do alerta configurado.',
    payload: engageEnvelope('WebhookCosmosBalanceLow', 'cosmos.balance.low', {
      balance_credits: z.number().int(),
      threshold_credits: z.number().int().nonnegative(),
    }),
  },
  {
    topic: 'fan.profile.deleted',
    modules: WEBHOOK_TOPIC_PREFIXES.fan,
    status: 'planned',
    label: { pt: 'Perfil excluído', es: 'Perfil eliminado', en: 'Profile deleted' },
    description:
      'O Perfil de um torcedor foi excluído (anonimizado). Apague o que você guarda associado a este `profile_id`.',
    payload: engageEnvelope('WebhookFanProfileDeleted', 'fan.profile.deleted', { profile_id: profileId }),
  },
];

const DATA_LABELS: Record<
  ChangeTopic,
  Labels & { module: (typeof WEBHOOK_DATA_MODULES)[number]; when: string }
> = {
  'event.status_changed': {
    module: 'core_data',
    pt: 'Status do jogo',
    es: 'Estado del partido',
    en: 'Match status',
    when: 'O status do evento mudou (início, intervalo, fim, adiamento).',
  },
  'event.score_changed': {
    module: 'core_data',
    pt: 'Placar',
    es: 'Marcador',
    en: 'Score',
    when: 'O placar do evento mudou.',
  },
  'event.incident_added': {
    module: 'core_data',
    pt: 'Lances',
    es: 'Jugadas',
    en: 'Incidents',
    when: 'Lances novos na timeline do evento (gols, cartões, substituições).',
  },
  'where_to_watch.changed': {
    module: 'where_to_watch',
    pt: 'Onde assistir',
    es: 'Dónde ver',
    en: 'Where to watch',
    when: 'As opções de onde assistir do evento mudaram nos seus mercados.',
  },
  'event.context_published': {
    module: 'live_intelligence',
    pt: 'Cenário e resumo (IA)',
    es: 'Previa y resumen (IA)',
    en: 'Preview and recap (AI)',
    when: 'Um texto de contexto do evento foi publicado.',
  },
  'event.related_content_changed': {
    module: 'related_content',
    pt: 'Vídeos relacionados',
    es: 'Videos relacionados',
    en: 'Related videos',
    when: 'Os vídeos relacionados ao evento mudaram.',
  },
};

const DATA_TOPICS: WebhookTopicDef[] = CHANGE_TOPICS.map((topic) => {
  const d = DATA_LABELS[topic];
  return {
    topic,
    modules: [d.module],
    status: 'live',
    label: { pt: d.pt, es: d.es, en: d.en },
    description: `${d.when} O corpo é uma \`RealtimeChange\`, o mesmo do SSE.`,
    payload: RealtimeChange,
  };
});

/** Todos os tópicos de webhook, dados primeiro e engajamento depois. */
export const WEBHOOK_TOPICS: readonly WebhookTopicDef[] = [...DATA_TOPICS, ...ENGAGE_TOPICS];

const BY_TOPIC = new Map(WEBHOOK_TOPICS.map((d) => [d.topic, d]));

export function webhookTopic(topic: string): WebhookTopicDef | undefined {
  return BY_TOPIC.get(topic);
}

export const isWebhookTopic = (topic: string): boolean => BY_TOPIC.has(topic);

/** Tópico de engajamento (fora dos seis de dados): é por tenant e vem com `tenant_id` no change feed. */
export const isEngageWebhookTopic = (topic: string): boolean =>
  BY_TOPIC.has(topic) && !(LEGACY_WEBHOOK_TOPICS as readonly string[]).includes(topic);

/** O tenant tem algum módulo que libera o tópico? */
export function webhookTopicEnabled(def: WebhookTopicDef, modules: readonly string[]): boolean {
  return def.modules.some((m) => modules.includes(m));
}

/**
 * Tópicos que o tenant pode assinar: emitidos (`live`) e de um módulo ligado. É o que a tela do cliente lista e o
 * que vale num webhook sem tópico marcado ("todos").
 */
export function webhookTopicsForModules(modules: readonly string[]): WebhookTopicDef[] {
  return WEBHOOK_TOPICS.filter((d) => d.status === 'live' && webhookTopicEnabled(d, modules));
}

/**
 * Por que o nome não serve, ou `undefined` se serve: fora da convenção, prefixo sem módulo, prefixo que não bate
 * com os módulos declarados. Os tópicos legados passam.
 */
export function webhookTopicNameProblem(def: Pick<WebhookTopicDef, 'topic' | 'modules'>): string | undefined {
  if ((LEGACY_WEBHOOK_TOPICS as readonly string[]).includes(def.topic)) return undefined;
  if (!WEBHOOK_TOPIC_PATTERN.test(def.topic)) return `${def.topic}: fora da convenção modulo.entidade.acao`;
  const prefix = def.topic.split('.')[0] as string;
  const expected = (WEBHOOK_TOPIC_PREFIXES as Record<string, readonly WebhookModule[]>)[prefix];
  if (!expected) return `${def.topic}: prefixo "${prefix}" não é de nenhum módulo`;
  const same = expected.length === def.modules.length && expected.every((m) => def.modules.includes(m));
  if (!same) return `${def.topic}: o prefixo "${prefix}" exige ${expected.join(', ')}`;
  return undefined;
}
