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
const profileId = z.uuid().meta({
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
    topic: 'game.prediction.scored',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'live',
    label: { pt: 'Palpite pontuado', es: 'Pronóstico puntuado', en: 'Prediction scored' },
    description:
      'O jogo terminou e o Palpite de um torcedor recebeu os Pontos definitivos (zero se errou). Sai uma vez por ' +
      'Palpite, depois da janela de correção do resultado.',
    payload: engageEnvelope('WebhookGamePredictionScored', 'game.prediction.scored', {
      profile_id: profileId,
      program_country: z.string().length(2).meta({ description: 'País do programa (ISO 3166-1 alfa-2).' }),
      event_id: z.uuid(),
      kind: z.enum(['exact_score', 'winner', 'quantity']),
      points: z.number().int().nonnegative(),
      full_hit: z.boolean().meta({ description: 'Acerto em cheio.' }),
    }),
  },
  {
    topic: 'game.prediction.reverted',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'live',
    label: { pt: 'Palpite revertido', es: 'Pronóstico revertido', en: 'Prediction reverted' },
    description:
      'Durante o jogo, um Palpite que estava certo deixou de estar (gol anulado pelo VAR, placar corrigido). A ' +
      'pontuação era provisória: nenhum Ponto é estornado.',
    payload: engageEnvelope('WebhookGamePredictionReverted', 'game.prediction.reverted', {
      profile_id: profileId,
      program_country: z.string().length(2),
      event_id: z.uuid(),
      kind: z.enum(['exact_score', 'winner', 'quantity']),
    }),
  },
  {
    topic: 'game.achievement.step_reached',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'live',
    label: {
      pt: 'Degrau de Conquista alcançado',
      es: 'Escalón de logro alcanzado',
      en: 'Achievement step reached',
    },
    description:
      'Um torcedor chegou a um Degrau de uma Conquista (vitalícia ou da temporada). Com `completed`, foi o último ' +
      'Degrau. Use para entregar a recompensa que o seu programa prende àquele Degrau.',
    payload: engageEnvelope('WebhookGameAchievementStepReached', 'game.achievement.step_reached', {
      profile_id: profileId,
      program_country: z.string().length(2),
      achievement_id: z
        .string()
        .meta({ description: 'Id estável da Conquista no Catálogo (`predictions.correct`).' }),
      season: z.string().meta({ description: '`all` (vitalícia) ou o ano da temporada.' }),
      step: z.number().int().min(1).max(5),
      completed: z.boolean(),
      card_key: z.string().nullable().meta({ description: 'Carta que o Degrau deu.' }),
      rule_version: z
        .number()
        .int()
        .positive()
        .meta({ description: 'Versão das regras do programa que valia quando o fato foi contado.' }),
      source_event: z.string().meta({
        description:
          'Id do fato real que disparou (o Palpite fechado, o jogo assistido), opaco e estável: o mesmo fato nunca ' +
          'dispara duas vezes.',
      }),
    }),
  },
  {
    topic: 'game.card.granted',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'live',
    label: { pt: 'Carta ganha', es: 'Carta ganada', en: 'Card granted' },
    description:
      'Um torcedor ganhou uma Carta ao chegar a um Degrau de Conquista. A Carta é certa por Degrau: sem sorteio, ' +
      'sem compra e sem troca. Sai junto com o `game.achievement.step_reached` do mesmo Degrau.',
    payload: engageEnvelope('WebhookGameCardGranted', 'game.card.granted', {
      profile_id: profileId,
      program_country: z.string().length(2),
      card_key: z
        .string()
        .meta({ description: 'Chave estável da Carta no Catálogo (`predictions.correct.1`).' }),
      achievement_id: z.string(),
      season: z.string().meta({ description: '`all` (vitalícia) ou o ano da temporada.' }),
      step: z.number().int().min(1).max(5),
      rule_version: z
        .number()
        .int()
        .positive()
        .meta({ description: 'Versão das regras do programa que valia quando o fato foi contado.' }),
      source_event: z.string().meta({
        description:
          'Id do fato real que disparou (o Palpite fechado, o jogo assistido), opaco e estável: o mesmo fato nunca ' +
          'dispara duas vezes.',
      }),
    }),
  },
  {
    topic: 'game.level.reached',
    modules: WEBHOOK_TOPIC_PREFIXES.game,
    status: 'live',
    label: { pt: 'Nível alcançado', es: 'Nivel alcanzado', en: 'Level reached' },
    description:
      'Os Pontos de um torcedor no programa passaram do mínimo de um Nível novo. O Nível vem do maior total de ' +
      'Pontos que ele já teve: o estorno de um Palpite corrigido não tira Nível, e o mesmo Nível nunca é avisado ' +
      'duas vezes. Use para entregar o que o seu programa prende ao Nível.',
    payload: engageEnvelope('WebhookGameLevelReached', 'game.level.reached', {
      profile_id: profileId,
      program_country: z.string().length(2),
      level: z.number().int().min(2).meta({ description: 'O Nível novo (o 1 é o de partida).' }),
      previous_level: z.number().int().min(1),
      points: z.number().int().nonnegative().meta({ description: 'Pontos do torcedor depois do crédito.' }),
      min_points: z.number().int().nonnegative().meta({ description: 'Mínimo de Pontos do Nível novo.' }),
      source_event: z.string().meta({ description: 'Id do crédito de Pontos que levou ao Nível, opaco.' }),
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
    description:
      'Planejado com o termo antigo; não é emitido. Use `game.achievement.step_reached`, que traz o Degrau.',
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
    description:
      'Não será emitido: os Pontos do programa não vencem (regra do programa). Fica no registro para o cliente ' +
      'saber que não precisa tratar vencimento.',
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
