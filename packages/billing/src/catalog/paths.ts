import { fileURLToPath } from 'node:url';

/**
 * Pasta do catálogo: `CATALOG_DIR` ou `config/catalog` na raiz do monorepo (mesma profundidade em src/ e dist/).
 * Na imagem, o pacote fica no node_modules do deploy e o caminho relativo não vale: o Dockerfile define `CATALOG_DIR`.
 */
export function defaultCatalogDir(): string {
  return process.env.CATALOG_DIR ?? fileURLToPath(new URL('../../../../config/catalog', import.meta.url));
}
