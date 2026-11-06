/**
 * Webhooks do painel do cliente (só no servidor): validação do formulário e a KEK que cifra o segredo.
 *
 * A demo recebe a mesma `WEBHOOK_SIGNING_SECRET` do worker para cadastrar e rotacionar segredos (cifra com ela,
 * nunca grava texto puro). Sem a KEK, o cadastro e a rotação ficam indisponíveis; o resto do painel funciona.
 */
import { isPublicHttpUrl } from '@galaxie/net-guard';
import {
  REALTIME_TOPICS,
  WebhookSecretBox,
  type RealtimeTopic,
  type WebhookFilters,
} from '@galaxie/db/webhooks';

let box: WebhookSecretBox | null | undefined;

/** A KEK do ambiente; `null` quando não está definida ou é inválida (curta demais). */
export function webhookSecrets(): WebhookSecretBox | null {
  if (box === undefined) {
    try {
      const b = WebhookSecretBox.fromEnv();
      box = b.configured ? b : null;
    } catch {
      box = null;
    }
  }
  return box;
}

export const LABEL_MAX = 120;
const MAX_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPORT = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface WebhookFormInput {
  url: string;
  label: string;
  topics: string[];
  sports: string;
  competitions: string;
  events: string;
}

export type WebhookFormError =
  | { kind: 'url' }
  | { kind: 'topics' }
  | { kind: 'label' }
  | { kind: 'ids'; field: 'sports' | 'competitions' | 'events' };

export interface ParsedWebhookForm {
  url: string;
  description: string | null;
  topics: RealtimeTopic[];
  filters: WebhookFilters;
}

const list = (raw: string) =>
  raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Valida o formulário. A URL tem de ser `https://`, sem credenciais, sem nome privado nem IP privado literal; o DNS
 * é conferido de novo pelo worker em cada entrega, no endereço que o socket usa.
 */
export function parseWebhookForm(input: WebhookFormInput): ParsedWebhookForm | WebhookFormError {
  const raw = input.url.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'url' };
  }
  if (url.protocol !== 'https:' || raw.length > 2000 || !isPublicHttpUrl(url.toString()))
    return { kind: 'url' };

  const label = input.label.trim();
  if (label.length > LABEL_MAX) return { kind: 'label' };

  const topics = [...new Set(input.topics)];
  if (!topics.every((t): t is RealtimeTopic => (REALTIME_TOPICS as readonly string[]).includes(t)))
    return { kind: 'topics' };

  const filters: WebhookFilters = {};
  const sports = list(input.sports);
  if (sports.length > MAX_IDS || !sports.every((s) => SPORT.test(s))) return { kind: 'ids', field: 'sports' };
  if (sports.length) filters.sports = [...new Set(sports)];
  for (const field of ['competitions', 'events'] as const) {
    const ids = list(input[field]);
    if (ids.length > MAX_IDS || !ids.every((id) => UUID.test(id))) return { kind: 'ids', field };
    if (ids.length) filters[field] = [...new Set(ids)];
  }
  return { url: url.toString(), description: label || null, topics, filters };
}
