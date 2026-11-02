import { connection } from 'next/server';

/**
 * A versão que este contêiner roda: o hash da entrada da imagem (tag in-<hash>), gravado no build. Sem sessão
 * (lib/public-routes.ts): o deploy e o smoke conferem por aqui.
 */
const startedAt = new Date().toISOString();

export async function GET() {
  // na hora do pedido: prerenderizada no next build, a rota responderia para sempre o valor de lá, sem o ENV da imagem
  await connection();
  return Response.json({
    service: 'demo',
    image_hash: process.env.GALAXIE_IMAGE_HASH || 'dev',
    started_at: startedAt,
    node: process.version,
  });
}
