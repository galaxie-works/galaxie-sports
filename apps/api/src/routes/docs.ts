import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument } from '@galaxie/contracts';

/**
 * Versão fixa do Scalar servido via CDN (atualize conscientemente) e o hash do arquivo, conferido pelo
 * navegador (SRI): CDN comprometida ou arquivo trocado não roda na página. O arquivo é o do pacote npm
 * (`dist/browser/standalone.js`), não o minificado que o jsDelivr gera na URL sem caminho, que pode mudar.
 * Ao trocar a versão, recalcule:
 *   curl -sL https://cdn.jsdelivr.net/npm/@scalar/api-reference@<v>/dist/browser/standalone.js  *     | openssl dgst -sha384 -binary | openssl base64 -A
 */
export const SCALAR_VERSION = '1.73.1';
export const SCALAR_URL = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js`;
export const SCALAR_INTEGRITY = 'sha384-kYDGzV91Jnn3TbHINV3nt54riK2uMJDfN5Al8dAkz4FssELTBWbD8rgw32sTKfOi';

const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Galaxie Sports API · Referência</title>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="${SCALAR_URL}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
  </body>
</html>`;

/** OpenAPI 3.1 em /openapi.json e referência interativa (Scalar) em /docs — rotas públicas. */
export async function docsRoutes(
  app: FastifyInstance,
  options: { publicUrl?: string | undefined },
): Promise<void> {
  const document = JSON.stringify(
    buildOpenApiDocument(options.publicUrl ? { serverUrl: options.publicUrl } : {}),
  );

  app.get('/openapi.json', async (_request, reply) =>
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(document),
  );

  app.get('/docs', async (_request, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(html),
  );
}
