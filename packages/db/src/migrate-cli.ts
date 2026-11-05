import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Journal } from './journal.js';
import { applyRoles, rolePasswordsFromEnv } from './roles.js';
import { migrationsFolder, runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}

// lock_timeout curto (perfil migrate): com um job segurando a tabela, desiste e tenta de novo em vez de
// enfileirar a API inteira atrás da migration
await runMigrations(url, {
  onRetry: (attempt) =>
    console.warn(`Migration esperou trava além do lock_timeout (tentativa ${attempt}); tentando de novo.`),
  concurrent: {
    onIndex: (index, outcome, ms) => {
      if (outcome === 'created')
        console.log(
          `Índice ${index.schema}.${index.name} criado com CONCURRENTLY em ${(ms / 1000).toFixed(1)} s.`,
        );
    },
  },
});
// O recibo no log (o Portainer do dev e o deploy leem daqui): até onde vai o journal desta imagem. Conferência contra
// o banco: `gs dev:esquema` (services/ingestor/src/dev/esquema.ts).
const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as Journal;
console.log(
  `Migrations aplicadas: esquema na ${journal.entries.at(-1)?.tag ?? 'nenhuma'} (${journal.entries.length} no journal da imagem).`,
);

// Papéis por serviço e GRANTs (roles.ts); DB_ROLES=off pula (banco sem o dono superusuário, por exemplo).
if (process.env.DB_ROLES?.trim().toLowerCase() === 'off') {
  console.log('Papéis do banco: pulados (DB_ROLES=off).');
} else {
  const { roles, login } = await applyRoles(url, { passwords: rolePasswordsFromEnv(process.env) });
  console.log(
    `Papéis do banco aplicados: ${roles.join(', ')}; com login: ${login.length ? login.join(', ') : 'nenhum'}.`,
  );
}
