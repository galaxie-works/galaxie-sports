/**
 * Anexos do "Sugerir ou reportar algo" no bucket PRIVADO (S3_TASKS_BUCKET, o mesmo das tarefas: sem leitura anônima
 * e fora do Traefik), em `feedback/<aaaa-mm>/<uuid>.<ext>`. Só no servidor. A issue mostra a imagem por um link
 * assinado da demo (`app/api/feedback/anexo/[...key]/route.ts`), que lê daqui.
 */
import { createHash } from 'node:crypto';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const PREFIX = 'feedback/';

/** Cliente refeito quando o endpoint, o bucket ou a chave mudam (chave trocada no painel, #1087). */
let client: { key: string; s3: S3Client; bucket: string } | null = null;

function store(env: NodeJS.ProcessEnv = process.env) {
  const { S3_ENDPOINT, S3_TASKS_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (!S3_ENDPOINT || !S3_TASKS_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  // nunca o bucket público dos assets: lá qualquer um leria pela chave
  if (S3_TASKS_BUCKET === env.S3_BUCKET) return null;
  // a chave do cache não guarda o segredo em claro (só a impressão dele); o cliente antigo não é fechado aqui: pode
  // haver envio em andamento nele
  const cacheKey = createHash('sha256')
    .update(JSON.stringify([S3_ENDPOINT, S3_TASKS_BUCKET, env.S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY]))
    .digest('hex');
  if (client?.key === cacheKey) return client;
  client = {
    key: cacheKey,
    s3: new S3Client({
      endpoint: S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    }),
    bucket: S3_TASKS_BUCKET,
  };
  return client;
}

/** Bucket privado configurado? (sem ele, envio com imagem responde "indisponível") */
export const attachmentStoreConfigured = () => store() !== null;

export async function putAttachment(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const c = store();
  if (!c) throw new Error('bucket privado dos anexos não configurado');
  await c.s3.send(
    new PutObjectCommand({ Bucket: c.bucket, Key: PREFIX + key, Body: body, ContentType: contentType }),
  );
}

/** Apaga o anexo (envio que falhou depois de gravar: não deixa imagem órfã no bucket). */
export async function deleteAttachment(key: string): Promise<void> {
  const c = store();
  if (!c) return;
  await c.s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: PREFIX + key }));
}

/** Bytes e tipo do anexo; null se não existe (ou o bucket não está configurado). */
export async function getAttachment(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  const c = store();
  if (!c) return null;
  try {
    const out = await c.s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: PREFIX + key }));
    if (!out.Body) return null;
    return {
      body: await out.Body.transformToByteArray(),
      contentType: out.ContentType === 'image/png' ? 'image/png' : 'image/jpeg',
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}
