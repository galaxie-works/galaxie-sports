import { runMigrations } from './migrate.js';

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
});
console.log('Migrations aplicadas.');
