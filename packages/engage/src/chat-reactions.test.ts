import { describe, expect, it } from 'vitest';
import {
  CHAT_REACTIONS,
  REACTION_EMOJI,
  canReact,
  compactCount,
  filterTally,
  isChatReaction,
  reactionEnabled,
} from './chat-reactions.js';

describe('reações do chat', () => {
  it('conjunto fixo de seis, cada uma com o emoji', () => {
    expect(CHAT_REACTIONS.map((r) => REACTION_EMOJI[r]).join('')).toBe('🔥👏😱😂😡⚽');
    expect(isChatReaction('fire')).toBe(true);
    expect(isChatReaction('heart')).toBe(false);
  });

  it('menor de 18 reage (não é texto); menor de 13 não entra', () => {
    expect(canReact('18plus')).toBe(true);
    expect(canReact('13_17')).toBe(true);
    expect(canReact('under13')).toBe(false);
  });

  it('o cliente escolhe quais aparecem', () => {
    expect(reactionEnabled(null, 'angry')).toBe(true);
    expect(reactionEnabled(['fire', 'clap'], 'angry')).toBe(false);
    expect(filterTally({ delta: { fire: 2, angry: 1 }, total: { fire: 9, angry: 4 } }, ['fire'])).toEqual({
      delta: { fire: 2 },
      total: { fire: 9 },
    });
  });

  it('contador compacto por idioma', () => {
    expect(compactCount(12_000, 'pt-BR')).toBe('12 mil');
    expect(compactCount(12_000, 'en')).toBe('12K');
    expect(compactCount(950, 'es-AR')).toBe('950');
  });
});
