/**
 * CSRF nas rotas de API que mudam estado (POST da revisão, da atividade e do erro de reprodução): a
 * sessão vai no cookie, então uma página de outro site poderia disparar o POST com o cookie da pessoa.
 * A rota só aceita a requisição feita pela própria demo — `Sec-Fetch-Site: same-origin` ou, em navegador
 * que não manda esse cabeçalho, `Origin` igual ao host da demo — e só com corpo
 * `content-type: application/json` (um formulário HTML de outro site não consegue mandar esse tipo sem
 * passar pelo preflight do CORS, que a demo não libera).
 *
 * As server actions do Next já fazem a conferência de `Origin` sozinhas; o login (`/api/auth`) tem a do
 * Better Auth; a revalidação interna (`/api/interno/revalidar`) é servidor a servidor, com assinatura.
 */

const NO_STORE = { 'cache-control': 'no-store' };

/** Hosts aceitos no `Origin`: o da requisição (atrás do proxy, o encaminhado) e o da URL pública. */
function expectedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwarded) hosts.add(forwarded.toLowerCase());
  const host = request.headers.get('host')?.trim();
  if (host) hosts.add(host.toLowerCase());
  try {
    hosts.add(new URL(request.url).host.toLowerCase());
  } catch {
    // URL relativa (não acontece no Next): fica só com os cabeçalhos
  }
  const publicUrl = process.env.BETTER_AUTH_URL?.trim();
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).host.toLowerCase());
    } catch {
      // URL pública inválida: ignora
    }
  }
  return hosts;
}

/** A requisição veio de uma página da própria demo? */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin')?.trim();
  if (!origin || origin === 'null') return false;
  try {
    return expectedHosts(request).has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

/** Corpo declarado como JSON (`application/json`, com ou sem charset)? */
export function isJsonBody(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json';
}

/**
 * Resposta de recusa (403 de outra origem, 415 sem JSON) ou `null` quando a requisição pode seguir.
 * Chamar antes de ler o corpo.
 */
export function rejectCrossSite(request: Request): Response | null {
  if (!isSameOrigin(request))
    return Response.json({ code: 'cross_site_request' }, { status: 403, headers: NO_STORE });
  if (!isJsonBody(request))
    return Response.json({ code: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
  return null;
}
