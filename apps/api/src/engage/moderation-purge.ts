/**
 * Apagamento automático da moderação e do Chat ao vivo (dados pessoais). De hora em hora, no processo da API, que já
 * escreve em `engage` e `chat`: casos, punições, auditoria e notas internas pelo `purgeModeration`, e as mensagens do
 * chat cujo relógio de conteúdo venceu. Cada linha carrega o prazo da ficha do país em que foi decidida
 * (`purge_at`); a ficha se escolhe em Ajustes → Fichas por país.
 *
 * Só roda com `MODERATION_PURGE=on` (Ajustes → Engajamento): desligado, nada é apagado.
 */
import { purgeModeration, readRuntimeOverrides, type Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';

/** A chave do painel está ligada? Banco fora ou valor inválido: desligado (apagar só com certeza). */
export async function moderationPurgeOn(
  db: Database,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  try {
    const overrides = await readRuntimeOverrides(db);
    return resolveSetting(settingDef('MODERATION_PURGE')!, { overrides, env: (k) => env[k] }).value === 'on';
  } catch {
    return false;
  }
}

/** Mensagens do chat com o relógio de conteúdo vencido, em lotes; com várias réplicas, uma apaga de cada vez. */
export async function purgeChatMessages(db: Database, now: Date, batchSize = 5000): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended('chat.message:purge', 0)) as ok`,
      );
      if (!lock?.ok) return 0;
      // a fixada que sai desafixa a sala junto
      await tx.execute(sql`
        update chat.room r set pinned_message_id = null, pinned_by = null, pinned_at = null, updated_at = now()
         where r.pinned_message_id is not null
           and exists (select 1 from chat.message m where m.tenant_id = r.tenant_id and m.id = r.pinned_message_id
                        and m.purge_at <= ${now.toISOString()}::timestamptz)`);
      const rows = await tx.execute<{ id: string }>(sql`
        delete from chat.message
         where (tenant_id, id) in (select tenant_id, id from chat.message
                                    where purge_at <= ${now.toISOString()}::timestamptz limit ${batchSize})
        returning id`);
      return rows.length;
    });
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

export function startModerationPurge(
  db: Database,
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void },
  everyMs = 3_600_000,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (!(await moderationPurgeOn(db))) return;
      const moderation = await purgeModeration(db);
      const chatMessages = await purgeChatMessages(db, new Date());
      const total = Object.values(moderation).reduce((a, b) => a + b, 0) + chatMessages;
      if (total) log.info({ ...moderation, chatMessages }, 'apagamento automático da moderação');
    } catch (err) {
      log.warn({ err }, 'apagamento automático da moderação falhou');
    } finally {
      running = false;
    }
  };
  // a primeira rodada sai poucos minutos depois de subir (com deploys seguidos, o intervalo sozinho nunca chegaria)
  const first = setTimeout(() => void run(), Math.floor(60_000 + Math.random() * 240_000));
  first.unref();
  const timer = setInterval(() => void run(), everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
