import { describe, expect, it } from 'vitest';
import { checkWebhookEventData } from './webhooks.js';

const PROFILE = '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10';

describe('publishWebhookEvent: conferência no registro (#1023)', () => {
  it('grava só os campos declarados: dado pessoal passado por engano não entra no change feed', () => {
    expect(
      checkWebhookEventData('fan.profile.deleted', { profile_id: PROFILE, email: 'torcedor@exemplo.com' }),
    ).toEqual({ profile_id: PROFILE });
  });

  it('recusa tópico fora do registro, tópico de dados e payload fora do schema', () => {
    expect(() => checkWebhookEventData('fan.profile.removed', { profile_id: PROFILE })).toThrow(/registro/);
    expect(() => checkWebhookEventData('event.score_changed', {})).toThrow(/registro/);
    expect(() => checkWebhookEventData('fan.profile.deleted', { profile_id: 'joao@x.com' })).toThrow(
      /schema/,
    );
  });
});
