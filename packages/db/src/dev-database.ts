/**
 * Reconhece a URL do Postgres de DESENVOLVIMENTO (o do NAS da LAN: host 192.168.1.34 ou porta 5433, a do
 * `infra/nas-dev/compose.yml`). Arquivo gerado a partir de dados (manifesto do acervo, relatório de cobertura) é gerado
 * contra a produção, nunca contra o dev: os ids do dev são os da produção só até o próximo espelho, e o que o dev tem a
 * mais ou a menos entraria no arquivo versionado (#525, #551). As CLIs avisam quando a URL é a do dev
 * (docs/runbooks/ambiente-de-dev.md › Arquivos gerados a partir de dados).
 */

/** Host do Postgres de dev no NAS da LAN. */
export const DEV_DATABASE_HOST = '192.168.1.34';
/** Porta publicada pelo Postgres da stack de dev do NAS. */
export const DEV_DATABASE_PORT = '5433';

/** `true` quando a URL aponta para o Postgres de dev (host do NAS ou porta 5433); URL inválida conta como não. */
export function isDevDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.hostname === DEV_DATABASE_HOST || parsed.port === DEV_DATABASE_PORT;
}

/**
 * Aviso para a CLI quando `url` é a do dev e o comando gera um arquivo a partir de dados; `undefined` fora do dev.
 * `what` nomeia o arquivo (ex.: "o manifesto do acervo").
 */
export function devDatabaseWarning(url: string | undefined, what: string): string | undefined {
  if (!isDevDatabaseUrl(url)) return undefined;
  return (
    `Aviso: DATABASE_URL é o Postgres de DEV (host ${DEV_DATABASE_HOST} ou porta ${DEV_DATABASE_PORT}). ` +
    `${what[0]?.toUpperCase() ?? ''}${what.slice(1)} é gerado contra a PRODUÇÃO, nunca contra o dev: ` +
    'os ids e o cadastro do dev só batem com a produção até o próximo espelho (docs/runbooks/ambiente-de-dev.md).'
  );
}
