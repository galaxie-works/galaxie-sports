/**
 * Escreve o OpenAPI da API pública (buildOpenApiDocument) em JSON, para o diff de contrato do CI
 * (.github/workflows/openapi.yml). O build do pacote pode vir de outro checkout (a base do PR):
 *
 *   node packages/contracts/scripts/openapi-dump.mjs [dist do @galaxie/contracts] > openapi.json
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../dist/', import.meta.url));
const { buildOpenApiDocument } = await import(pathToFileURL(resolve(dist, 'index.js')).href);
process.stdout.write(`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
