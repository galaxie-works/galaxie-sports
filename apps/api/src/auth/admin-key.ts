import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ACTOR_RE } from '@galaxie/where-to-watch';
import { problems } from '../errors.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Rotas internas (/internal/...) exigem `x-galaxie-admin-key` igual a ADMIN_API_KEY (comparação em
 * tempo constante) e `x-galaxie-actor` com o handle interno de quem age (sem e-mail) — vai para a
 * trilha de auditoria. Sem ADMIN_API_KEY configurada, as rotas respondem 503.
 */
export function assertAdmin(request: FastifyRequest, adminKey: string | undefined): string {
  if (!adminKey) throw problems.degraded('Rotas internas desabilitadas: defina ADMIN_API_KEY.');
  const header = request.headers['x-galaxie-admin-key'];
  const given = Array.isArray(header) ? header[0] : header;
  if (!given || !timingSafeEqual(digest(given), digest(adminKey)))
    throw problems.invalidKey('Envie a chave administrativa em x-galaxie-admin-key.');
  const actorHeader = request.headers['x-galaxie-actor'];
  const actor = (Array.isArray(actorHeader) ? actorHeader[0] : actorHeader)?.trim() ?? '';
  if (!ACTOR_RE.test(actor))
    throw problems.invalidParams(
      [
        {
          path: 'x-galaxie-actor',
          message: 'handle interno obrigatório (letras, números, . _ -; sem e-mail)',
        },
      ],
      'Identifique quem faz a correção.',
    );
  return actor;
}
