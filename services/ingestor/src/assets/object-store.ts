import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StoredObjectInfo {
  bytes: number;
  contentType: string | undefined;
  sha256: string | undefined;
}

/** Object storage dos assets (S3/RustFS em produção e local; memória nos testes). */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void>;
  head(key: string): Promise<StoredObjectInfo | undefined>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

export class InMemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string; sha256: string }>();

  async put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void> {
    this.objects.set(key, { body, contentType, sha256 });
  }

  async head(key: string): Promise<StoredObjectInfo | undefined> {
    const o = this.objects.get(key);
    return o && { bytes: o.body.length, contentType: o.contentType, sha256: o.sha256 };
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key)?.body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export interface S3ObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string | undefined;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** S3 compatível (RustFS local, qualquer provedor S3 em produção) com endereçamento por caminho. */
export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;

  constructor(private readonly options: S3ObjectStoreOptions) {
    this.s3 = new S3Client({
      endpoint: options.endpoint,
      region: options.region ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // o fornecedor às vezes troca um logo; uma semana de cache é um bom meio-termo para o CDN
        CacheControl: 'public, max-age=604800',
        Metadata: { sha256 },
      }),
    );
  }

  async head(key: string): Promise<StoredObjectInfo | undefined> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { bytes: res.ContentLength ?? 0, contentType: res.ContentType, sha256: res.Metadata?.sha256 };
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : undefined;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  close(): void {
    this.s3.destroy();
  }
}

/** Monta o S3ObjectStore a partir de S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (S3_REGION opcional). */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): S3ObjectStore {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    throw new Error('Defina S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY (.env).');
  }
  return new S3ObjectStore({
    endpoint: S3_ENDPOINT,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
  });
}
