import type { EventSession } from '@galaxie/contracts';

import type { Dictionary } from './i18n/dictionary';
import { fill } from './i18n/text';

/**
 * Nome da sessão de corrida no idioma da tela, pelo tipo e número ("Classificação · Q3", "Practice 2").
 * A API só tem conteúdo em português e espanhol: em inglês, o `name` dela vinha "Carrera".
 */
export function sessionLabel(
  session: Pick<EventSession, 'type' | 'number' | 'name'> | null | undefined,
  t: Dictionary['sport'],
): string | null {
  if (!session) return null;
  const base = t.sessions[session.type];
  if (!base) return session.name;
  if (session.type === 'practice') return fill(base, { n: session.number ?? '' }).trim();
  if (session.number && session.type === 'qualifying') return `${base} · Q${session.number}`;
  if (session.number && session.type === 'sprint_qualifying') return `${base} · SQ${session.number}`;
  return base;
}
