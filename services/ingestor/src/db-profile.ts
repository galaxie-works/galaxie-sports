import type { DbProfile } from '@galaxie/db';

/**
 * Perfil de tempos do banco de um processo do ingestor: `live` dentro do serviço do ao vivo (`SCHEDULER_PROFILE=live`,
 * que os jobs herdam do scheduler), o padrão (`job`) no resto. Ver packages/db/src/client.ts › DB_TIMEOUTS. Fica fora
 * do context.ts para quem só abre o banco (postgame-close ocioso) não carregar o cliente do fornecedor e o logger.
 */
export function dbProfileFromEnv(env: NodeJS.ProcessEnv = process.env): DbProfile | undefined {
  return env.SCHEDULER_PROFILE?.trim().toLowerCase() === 'live' ? 'live' : undefined;
}
