/**
 * Storage de assets para o upload de logos do painel (só no servidor): o mesmo bucket S3/RustFS que a API
 * serve (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION opcional), gravado como o
 * `S3ObjectStore` do ingestor (cache de uma semana; a chave muda quando o arquivo muda).
 */
import { createHash } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { LogoObjectStore } from '@galaxie/where-to-watch/logo-upload';

/** Cliente refeito quando o endpoint, o bucket ou a chave mudam (chave trocada no painel, #1087). */
let client: { key: string; s3: S3Client; bucket: string } | null = null;

/** Storage configurado no ambiente? (sem ele, o painel mostra o upload desligado). */
export function logoStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
}

/** Storage do ambiente; null se S3_* não estiver configurado. */
export function logoObjectStore(env: NodeJS.ProcessEnv = process.env): LogoObjectStore | null {
  if (!logoStorageConfigured(env)) return null;
  // a chave do cache não guarda o segredo em claro (só a impressão dele); o cliente antigo não é fechado aqui: pode
  // haver envio em andamento nele
  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify([env.S3_ENDPOINT, env.S3_BUCKET, env.S3_REGION, env.S3_ACCESS_KEY, env.S3_SECRET_KEY]),
    )
    .digest('hex');
  if (client?.key !== cacheKey) {
    client = {
      key: cacheKey,
      s3: new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
        // upload do painel: S3 travado vira erro na tela em vez de requisição pendurada
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      }),
      bucket: env.S3_BUCKET!,
    };
  }
  const { s3, bucket } = client;
  return {
    async put(key, body, contentType, sha256) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=604800',
          Metadata: { sha256 },
        }),
      );
    },
  };
}
