import { generateAdminKey, hashAdminKey } from '../admin/guard.js';

// Gera uma chave administrativa para /internal/admin/*. Só o hash vai para o ambiente do servidor
// (ADMIN_KEY_HASHES, separado por vírgula — mantenha o antigo durante a rotação e remova depois).
const key = generateAdminKey();
console.log('Chave administrativa (guarde num cofre de segredos; não será exibida novamente):\n');
console.log(`  ${key}\n`);
console.log('Adicione o hash ao ambiente da API:\n');
console.log(`  ADMIN_KEY_HASHES=${hashAdminKey(key)}\n`);
console.log('Uso: curl -H "x-galaxie-admin-key: <chave>" http://localhost:8080/internal/admin/plans');
