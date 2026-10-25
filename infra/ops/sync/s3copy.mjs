// Copia para o bucket da produção os objetos do bucket de dev (NAS) que ainda não existem lá.
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
const mk = (endpoint, id, key) =>
  new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: id, secretAccessKey: key },
  });
const src = mk(process.env.SRC_ENDPOINT, process.env.SRC_ID, process.env.SRC_KEY);
const dst = mk(process.env.DST_ENDPOINT, process.env.DST_ID, process.env.DST_KEY);
const Bucket = process.env.BUCKET;
let token,
  seen = 0,
  copied = 0,
  bytes = 0,
  failed = 0;
async function copy(Key) {
  try {
    await dst.send(new HeadObjectCommand({ Bucket, Key }));
    return;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound') throw e;
  }
  const o = await src.send(new GetObjectCommand({ Bucket, Key }));
  const body = await o.Body.transformToByteArray();
  await dst.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body: body,
      ContentType: o.ContentType,
      CacheControl: o.CacheControl,
      Metadata: o.Metadata,
    }),
  );
  copied++;
  bytes += body.length;
}
do {
  const page = await src.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token, MaxKeys: 1000 }));
  const keys = (page.Contents ?? []).map((c) => c.Key);
  for (let i = 0; i < keys.length; i += 16)
    await Promise.all(
      keys.slice(i, i + 16).map((k) =>
        copy(k).catch((e) => {
          failed++;
          if (failed < 5) console.error(k, e?.name ?? e);
        }),
      ),
    );
  seen += keys.length;
  token = page.NextContinuationToken;
  if (seen % 10000 < 1000)
    console.log(`vistos ${seen} · copiados ${copied} (${(bytes / 1e6).toFixed(0)} MB) · falhas ${failed}`);
} while (token);
console.log(`FIM vistos ${seen} · copiados ${copied} (${(bytes / 1e6).toFixed(0)} MB) · falhas ${failed}`);
