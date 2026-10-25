/**
 * Trava de execução por job (scheduler): advisory lock de **sessão** do Postgres numa conexão própria,
 * aberta enquanto o job roda. Impede dois processos de rodarem o mesmo job ao mesmo tempo (ex.:
 * `scheduler --run live-run` no console com o ao vivo agendado no ar, ou dois contêineres sobrepostos no
 * deploy). Se o processo que a segura cair, a conexão cai junto e o Postgres solta a trava: nunca fica
 * presa depois de um crash.
 */
import postgres from 'postgres';

export interface JobLock {
  /** Solta a trava e fecha a conexão (idempotente). */
  release(): Promise<void>;
}

/** Espaço de chaves das travas de job (o par de int4 não colide com as travas de chave única). */
const JOB_LOCK_SPACE = 'galaxie:job';

export interface JobLockOptions {
  /**
   * A conexão dedicada caiu com o job ainda rodando (banco reiniciado, rede): a trava sumiu junto e outro
   * processo pode começar o mesmo job.
   */
  onLost?: (() => void) | undefined;
}

/**
 * Tenta pegar a trava do job sem esperar. Devolve `null` se outro processo já está rodando o job.
 * A conexão fica aberta até `release()` (sem tempo de vida máximo: fechar a conexão soltaria a trava).
 */
export async function tryJobLock(
  url: string,
  job: string,
  options: JobLockOptions = {},
): Promise<JobLock | null> {
  let released = false;
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    onnotice: () => {},
    onclose: () => {
      if (!released) options.onLost?.();
    },
  });
  const close = async () => {
    released = true;
    await sql.end({ timeout: 5 });
  };
  try {
    const [row] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${JOB_LOCK_SPACE}), hashtext(${job})) as locked`;
    if (!row?.locked) {
      await close();
      return null;
    }
  } catch (err) {
    await close().catch(() => {});
    throw err;
  }
  return {
    async release() {
      if (released) return;
      released = true;
      // fechar a sessão já solta a trava; o unlock explícito só deixa isso claro nos logs do banco
      await sql`select pg_advisory_unlock(hashtext(${JOB_LOCK_SPACE}), hashtext(${job}))`.catch(() => {});
      await sql.end({ timeout: 5 });
    },
  };
}
