import { describe, expect, it } from 'vitest';
import type { ChangeRow } from '../realtime/changes.js';
import { engageEventMatches, toEngageWebhook, type EngageWebhookEvent } from './engage-events.js';

const TENANT = '0192c7e2-0000-7000-8000-000000000001';
const OTHER = '0192c7e2-0000-7000-8000-000000000002';
const PROFILE = '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10';

const row = (topic: string, payload: unknown): ChangeRow => ({
  id: 42,
  topic,
  entityType: 'webhook_event',
  entityId: 'x',
  payload,
  createdAt: new Date('2026-11-11T12:00:00.000Z'),
});

const event = (topic: string, data: unknown, tenantId = TENANT): EngageWebhookEvent => {
  const e = toEngageWebhook(row(topic, { tenant_id: tenantId, data }));
  if (!e || 'invalid' in e) throw new Error('evento inválido');
  return e;
};

describe('eventos de engajamento nos webhooks', () => {
  it('monta o corpo pelo schema do registro, sem tenant_id e sem campo não declarado', () => {
    const e = event('fan.profile.deleted', { profile_id: PROFILE, email: 'torcedor@exemplo.com', cpf: '1' });
    expect(e.body).toEqual({
      id: '42',
      topic: 'fan.profile.deleted',
      occurred_at: '2026-11-11T12:00:00.000Z',
      data: { profile_id: PROFILE },
    });
    expect(JSON.stringify(e.body)).not.toContain(TENANT);
  });

  it('ignora tópico de dados e recusa evento fora do schema', () => {
    expect(toEngageWebhook(row('event.score_changed', {}))).toBeUndefined();
    expect(toEngageWebhook(row('catalog', {}))).toBeUndefined();
    expect(toEngageWebhook(row('fan.profile.deleted', { data: { profile_id: PROFILE } }))).toHaveProperty(
      'invalid',
    );
    expect(
      toEngageWebhook(row('fan.profile.deleted', { tenant_id: TENANT, data: { profile_id: 'joao@x.com' } })),
    ).toHaveProperty('invalid');
  });

  it('módulo desligado não dispara, mesmo com o tópico marcado', () => {
    const e = event('game.points.expiring', {
      profile_id: PROFILE,
      program_id: PROFILE,
      points: 100,
      expires_at: '2026-12-01T00:00:00.000Z',
    });
    const ep = { tenantId: TENANT, topics: ['game.points.expiring'] };
    expect(engageEventMatches(e, { ...ep, modules: ['core_data', 'live_chat'] })).toBe(false);
    expect(engageEventMatches(e, { ...ep, modules: ['core_data', 'gamification'] })).toBe(true);
  });

  it('só vai para endpoints do tenant do evento', () => {
    const e = event('fan.profile.deleted', { profile_id: PROFILE }, OTHER);
    expect(
      engageEventMatches(e, { tenantId: TENANT, modules: ['live_chat'], topics: ['fan.profile.deleted'] }),
    ).toBe(false);
  });

  it('fan.* vale com qualquer módulo de engajamento, nunca só com dados', () => {
    const e = event('fan.profile.deleted', { profile_id: PROFILE });
    const ep = (modules: string[]) => ({ tenantId: TENANT, modules, topics: ['fan.profile.deleted'] });
    expect(engageEventMatches(e, ep(['shopping']))).toBe(true);
    expect(engageEventMatches(e, ep(['core_data', 'where_to_watch']))).toBe(false);
  });

  it('webhook sem tópico marcado não recebe tópico em breve', () => {
    const e = event('fan.profile.deleted', { profile_id: PROFILE });
    expect(e.def.status).toBe('planned');
    expect(engageEventMatches(e, { tenantId: TENANT, modules: ['live_chat'], topics: [] })).toBe(false);
    expect(
      engageEventMatches(
        { ...e, def: { ...e.def, status: 'live' } },
        {
          tenantId: TENANT,
          modules: ['live_chat'],
          topics: [],
        },
      ),
    ).toBe(true);
  });
});
