import type { FastifyRequest } from 'fastify';
import { ACTOR_RE } from '@galaxie/where-to-watch';
import type { AdminGuard } from '../admin/guard.js';
import { problems } from '../errors.js';

/**
 * Rotas internas (/internal/...) usam o mesmo AdminGuard das rotas /internal/admin: allowlist de IP
 * (ADMIN_IP_ALLOWLIST) e chave administrativa com hash (ADMIN_KEY_HASHES) no header
 * `x-galaxie-admin-key`. Exigem também `x-galaxie-actor` com o handle interno de quem age (sem
 * e-mail), que vai para a trilha de auditoria. Sem ADMIN_KEY_HASHES configurado, respondem 503.
 */
export function assertAdmin(request: FastifyRequest, guard: AdminGuard | undefined): string {
  if (!guard) throw problems.degraded('Rotas internas desabilitadas: defina ADMIN_KEY_HASHES.');
  guard.check(request);
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
