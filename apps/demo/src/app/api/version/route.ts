/**
 * A versão que este contêiner roda: o hash da entrada da imagem (tag in-<hash>), gravado no build. Sem sessão
 * (lib/public-routes.ts): o deploy e o smoke conferem por aqui. Lido na hora, para não ficar fora de sincronia com a
 * imagem: a página não é estática.
 */
export const dynamic = 'force-dynamic';

const startedAt = new Date().toISOString();

export function GET() {
  return Response.json({
    service: 'demo',
    image_hash: process.env.GALAXIE_IMAGE_HASH || 'dev',
    started_at: startedAt,
    node: process.version,
  });
}
