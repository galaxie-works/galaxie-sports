import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // o player dos vídeos é um iframe do YouTube: nos testes ele não carrega nada da rede
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
