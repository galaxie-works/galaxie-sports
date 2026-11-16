/**
 * Formato, geração e hash da chave secreta: moram em `@galaxie/db/api-keys` desde a F2 (o console emite a chave do
 * cadastro pelo mesmo caminho); este módulo só reexporta para o resto da API e para os testes.
 */
export {
  API_KEY_SCAN_PATTERN,
  formatApiKey,
  generateApiKey,
  hashSecret,
  parseApiKey,
  verifySecret,
  type KeyEnv,
  type ParsedKey,
} from '@galaxie/db/api-keys';
