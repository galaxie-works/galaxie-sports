/**
 * Cabeçalhos de segurança de todas as respostas da demo (`headers()` do next.config.ts).
 *
 * Valem já: só a própria demo põe a demo num iframe (`frame-ancestors 'self'` e `X-Frame-Options`,
 * contra clickjacking no painel de Ajustes; a apresentação abre o exemplo num iframe da mesma origem),
 * `nosniff`, `Referrer-Policy` e, em produção, HSTS.
 *
 * A CSP completa vai como `Content-Security-Policy-Report-Only` (o navegador só avisa no console o que
 * bloquearia): as origens abaixo saíram do código (player do YouTube sem cookies, imagens de escudos,
 * bandeiras e fotos por https, fontes do next/font servidas pela própria demo, Lottie "light" sem eval,
 * shiki no motor de regex em JS, sem WebAssembly), mas as imagens vêm de URLs da API e não dá para listar
 * todas as origens com certeza sem olhar a produção. Quando o console ficar limpo navegando pelas páginas
 * (home, ao vivo, evento com vídeo, docs, Builder, Ajustes), passar a CSP para `Content-Security-Policy`.
 * Os scripts inline do Next e do next-themes exigem `'unsafe-inline'` sem nonce, e nonce obrigaria toda
 * página a renderizar por requisição (perde o cache das páginas).
 *
 * Módulo puro (sem imports): o next.config.ts importa pelo caminho relativo.
 */

export interface SecurityHeadersOptions {
  /** Produção: HSTS e a CSP completa (em dev o Next precisa de eval e do websocket do HMR). */
  production: boolean;
}

/** CSP completa da demo (produção; ver o comentário do módulo). */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // IFrame Player API do YouTube (carregada ao abrir o player) e o script que ela puxa
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  // escudos, bandeiras, fotos e miniaturas vêm de URLs da API (CDN de assets, YouTube, Commons)
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // o navegador só fala com a própria demo (a API passa pelo proxy /api/galaxie, inclusive o SSE)
  "connect-src 'self'",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function securityHeaders({ production }: SecurityHeadersOptions): { key: string; value: string }[] {
  return [
    // produção: a CSP completa (inclui o frame-ancestors); dev: só o frame-ancestors
    {
      key: 'Content-Security-Policy',
      value: production ? CONTENT_SECURITY_POLICY : "frame-ancestors 'self'",
    },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ...(production
      ? [
          // sem includeSubDomains nem preload: vale só para o domínio da demo
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ]
      : []),
  ];
}
