import { defineConfig } from 'vitest/config';

// O sharp (WebP com effort 6, vários tamanhos por escudo) passa de 5 s com o CI rodando os pacotes em
// paralelo: o mesmo teto que estes testes tinham no ingestor.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
