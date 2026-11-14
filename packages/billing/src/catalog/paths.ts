import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pasta do catálogo: `CATALOG_DIR` ou `config/catalog` na raiz do monorepo (mesma profundidade em src/ e dist/).
 * Na imagem, o pacote fica no node_modules do deploy e o caminho relativo não vale: o Dockerfile define `CATALOG_DIR`.
 */
export function defaultCatalogDir(): string {
  // sem `new URL('<relativo>', import.meta.url)`: o empacotador do Next trata isso como asset e tenta resolver a pasta no
  // build
  return (
    process.env.CATALOG_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'config', 'catalog')
  );
}
