import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { buildOpenApiDocument } from './openapi.js';
import { CHANGE_TOPICS } from './realtime.js';
import {
  isEngageWebhookTopic,
  WEBHOOK_TOPICS,
  webhookTopicNameProblem,
  webhookTopicsForModules,
} from './webhook-topics.js';

/** Campos que nunca podem sair num webhook: dado pessoal do torcedor. */
const PERSONAL =
  /(^|_)(e_?mail|document|cpf|dni|rut|curp|phone|telefone|birth|nascimento|address|endereco|ip|name|nome)(_|$)/i;

function keysOf(schema: unknown, out: string[] = []): string[] {
  const s = schema as z.ZodType & { shape?: Record<string, z.ZodType>; unwrap?: () => z.ZodType };
  if (s instanceof z.ZodObject) {
    for (const [k, v] of Object.entries(s.shape)) {
      out.push(k);
      keysOf(v, out);
    }
  } else if (s instanceof z.ZodNullable || s instanceof z.ZodOptional) keysOf(s.unwrap(), out);
  else if (s instanceof z.ZodArray) keysOf(s.element, out);
  return out;
}

describe('registro de tópicos de webhook', () => {
  it('todo tópico segue a convenção modulo.entidade.acao (os seis legados à parte)', () => {
    expect(WEBHOOK_TOPICS.map(webhookTopicNameProblem).filter(Boolean)).toEqual([]);
    expect(new Set(WEBHOOK_TOPICS.map((d) => d.topic)).size).toBe(WEBHOOK_TOPICS.length);
  });

  it('recusa tópico fora da convenção ou com prefixo que não é do módulo', () => {
    const bad = [
      { topic: 'achievement.level_reached', modules: ['gamification'] },
      { topic: 'reward.triggered', modules: ['gamification'] },
      { topic: 'Game.Points.Expiring', modules: ['gamification'] },
      { topic: 'game.points-expiring.now', modules: ['gamification'] },
      { topic: 'game.points.expiring.soon', modules: ['gamification'] },
      { topic: 'loyalty.points.expiring', modules: ['gamification'] },
      { topic: 'game.points.expiring', modules: ['shopping'] },
      { topic: 'fan.profile.deleted', modules: ['live_chat'] },
      { topic: 'event.lineup_published', modules: ['core_data'] },
    ] as const;
    for (const def of bad) expect(webhookTopicNameProblem(def), def.topic).toBeDefined();
    expect(
      webhookTopicNameProblem({ topic: 'game.points.expiring', modules: ['gamification'] }),
    ).toBeUndefined();
  });

  it('os seis tópicos de dados continuam todos no registro, com o nome de sempre', () => {
    const data = WEBHOOK_TOPICS.filter((d) => !isEngageWebhookTopic(d.topic)).map((d) => d.topic);
    expect(data).toEqual([...CHANGE_TOPICS]);
  });

  it('payload de engajamento não declara dado pessoal, só o profile_id opaco', () => {
    for (const def of WEBHOOK_TOPICS.filter((d) => isEngageWebhookTopic(d.topic))) {
      const keys = keysOf(def.payload);
      expect(
        keys.filter((k) => PERSONAL.test(k)),
        def.topic,
      ).toEqual([]);
    }
  });

  it('o schema descarta campo não declarado (um e-mail que vaze no change feed não sai)', () => {
    const def = WEBHOOK_TOPICS.find((d) => d.topic === 'fan.profile.deleted')!;
    const out = def.payload.parse({
      id: '1',
      topic: 'fan.profile.deleted',
      occurred_at: '2026-11-11T12:00:00.000Z',
      data: { profile_id: '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10', email: 'x@y.z' },
      email: 'x@y.z',
    });
    expect(JSON.stringify(out)).not.toContain('x@y.z');
  });

  it('tópico de módulo desligado não aparece; em breve também não', () => {
    const topics = (mods: string[]) => webhookTopicsForModules(mods).map((d) => d.topic);
    expect(topics(['core_data'])).toEqual([
      'event.status_changed',
      'event.score_changed',
      'event.incident_added',
    ]);
    expect(topics(['core_data'])).not.toContain('where_to_watch.changed');
    // engajamento ainda não emite: nenhum aparece, mesmo com o módulo ligado
    expect(topics(['live_chat', 'gamification', 'cosmos_ai'])).toEqual([]);
  });

  it('a documentação da API traz um webhook por tópico do registro', () => {
    const doc = buildOpenApiDocument();
    // vídeos relacionados ficam fora do documento publicado até decisão do dono
    const published = WEBHOOK_TOPICS.map((d) => d.topic).filter((t) => t !== 'event.related_content_changed');
    expect(Object.keys(doc.webhooks ?? {}).sort()).toEqual(published.sort());
    const op = doc.webhooks?.['game.points.expiring']?.post;
    expect(op?.description).toContain('`gamification`');
    expect(op?.description).toContain('Em breve');
  });
});
