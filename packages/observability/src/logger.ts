import { isIP } from 'node:net';
import { pino, stdTimeFunctions, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger, LoggerOptions };

/**
 * Campos padronizados dos logs (snake_case), para que API e ingestor possam ser filtrados igual:
 * `job_id`, `sport`, `endpoint`, `priority`, `source`, `outcome`, `duration_ms`.
 */
export interface LogContext {
  job_id?: string;
  sport?: string;
  endpoint?: string;
  [key: string]: unknown;
}

export interface LoggerConfig {
  /** Nome do serviço (api, ingestor, scheduler...) — vai em todo log como `service`. */
  service: string;
  /** Padrão: LOG_LEVEL ou "info". */
  level?: string;
  /** Padrão: APP_ENV, NODE_ENV ou "development". */
  environment?: string;
}

/** Chaves que nunca podem aparecer em log (segredos de fornecedor, de tenant e de infraestrutura). */
export const REDACTED_PATHS = [
  'apiKey',
  'password',
  'secret',
  'token',
  'authorization',
  '*.apiKey',
  '*.password',
  '*.secret',
  '*.token',
  '*.authorization',
  'headers.authorization',
  'headers["x-apisports-key"]',
  'headers["x-api-key"]',
  'req.headers.authorization',
  'req.headers["x-apisports-key"]',
  'req.headers["x-api-key"]',
  'req.headers.cookie',
];

/** Opções do pino compartilhadas por todos os serviços (JSON, horário ISO, nível como texto, segredos ocultos). */
export function loggerOptions(config: LoggerConfig, env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  return {
    level: config.level ?? env.LOG_LEVEL ?? 'info',
    base: {
      service: config.service,
      env: config.environment ?? env.APP_ENV ?? env.NODE_ENV ?? 'development',
    },
    messageKey: 'msg',
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };
}

/** Logger JSON para stdout. `destination` existe para testes. */
export function createLogger(
  config: LoggerConfig,
  destination?: DestinationStream,
  env: NodeJS.ProcessEnv = process.env,
): Logger {
  const options = loggerOptions(config, env);
  return destination ? pino(options, destination) : pino(options);
}

/**
 * Mascara o IP do usuário final antes de logar (docs/11 §3 — logs não guardam IP completo):
 * IPv4 → /24 (último octeto zerado); IPv6 → /48.
 */
export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return v4.replace(/\.\d+$/, '.0');
  if (isIP(ip) === 6) {
    const [head = ''] = ip.split('::');
    const groups = head.split(':').filter(Boolean).slice(0, 3);
    return `${groups.join(':')}::/48`;
  }
  return undefined;
}
