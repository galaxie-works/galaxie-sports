/**
 * Imagem anexada a uma sugestão do app, pelo link assinado que vai na issue (lib/feedback/signing.ts). Sem sessão
 * (o GitHub busca a imagem pelo proxy dele; ver `lib/public-routes.ts`), mas só com assinatura válida e no prazo:
 * o arquivo fica no bucket privado e a chave sozinha não abre nada. Recusa = 404, sem dizer o motivo.
 */
import { getAttachment } from '@/lib/feedback/attachments';
import { verifyAttachmentLink } from '@/lib/feedback/signing';

const notFound = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request, ctx: RouteContext<'/api/feedback/anexo/[...key]'>) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return notFound();
  const key = (await ctx.params).key.join('/');
  const url = new URL(request.url);
  const nowS = Math.floor(Date.now() / 1000);
  if (!verifyAttachmentLink(secret, key, url.searchParams.get('e'), url.searchParams.get('s'), nowS))
    return notFound();
  const file = await getAttachment(key).catch((err) => {
    console.error('[feedback] falha ao ler o anexo', err);
    return null;
  });
  if (!file) return notFound();
  return new Response(Buffer.from(file.body), {
    headers: {
      'content-type': file.contentType,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'x-robots-tag': 'noindex',
    },
  });
}
