/**
 * Configuração da execução, lida do ambiente por quem precisa: o executor (`run.ts`), o `playwright.config.ts` e os
 * testes. Os padrões servem à máquina de quem desenvolve; o job `e2e` do CI usa os mesmos.
 *
 * As portas da API e da demo são outras que as do `pnpm dev` (8080 e 3000) de propósito: o teste sobe os servidores
 * dele, apontados para o banco descartável, sem esbarrar num servidor de desenvolvimento ligado no banco de verdade.
 */
import { fileURLToPath } from 'node:url';

const port = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} inválida: ${process.env[name]}`);
  return value;
};

export const API_PORT = port('E2E_API_PORT', 8180);
export const DEMO_PORT = port('E2E_DEMO_PORT', 3100);

/** Endereços em que os testes falam com a API e com a demo (só HTTP: nada de `apps/*` importado aqui). */
export const API_URL = process.env.E2E_API_URL || `http://localhost:${API_PORT}`;
export const DEMO_URL = process.env.E2E_DEMO_URL || `http://localhost:${DEMO_PORT}`;

/** SMTP falso (Mailpit): a demo manda por ele, o teste lê pela API HTTP dele. */
export const SMTP_HOST = process.env.E2E_SMTP_HOST || 'localhost';
export const SMTP_PORT = port('E2E_SMTP_PORT', 1025);
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL || 'http://localhost:8025';

/**
 * Pessoas de teste. O admin é o primeiro admin da demo (`DEMO_ADMIN_EMAIL`, criado na subida); o cliente é criado pelo
 * admin no projeto `setup`, com o papel `client` preso à marca semeada. Domínio `.test` (RFC 2606): nunca entrega fora.
 */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e.admin@galaxie.test';
export const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL || 'e2e.cliente@galaxie.test';

/** Sessões gravadas pelo projeto `setup` e reaproveitadas pelos outros testes. */
export const ADMIN_STATE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));
export const CLIENT_STATE = fileURLToPath(new URL('../.auth/client.json', import.meta.url));

/** Valor que o executor (`run.ts`) passa ao Playwright; faltando, o teste foi chamado fora do `pnpm e2e`. */
export function seeded(
  name: 'E2E_DATABASE_URL' | 'E2E_API_KEY' | 'E2E_DEMO_KEY' | 'E2E_CLIENT_TENANT_ID',
): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} ausente: rode pelo executor (pnpm --filter @galaxie/e2e-tests e2e), que cria o banco descartável e o seed.`,
    );
  return value;
}

/** Marca de referência semeada (`seed.ts`). */
export const CLIENT_TENANT_SLUG = 'marca-e2e';
