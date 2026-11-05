/**
 * `gs dev:esquema`: o esquema do banco de DEV está em dia com as migrations da main? (#550)
 *
 * O Postgres do dev mora no NAS da LAN e nenhum alertador alcança os dois lados ao mesmo tempo: o Prometheus da VPS
 * não enxerga o NAS, e o GitHub não entra na LAN. O alerta `DevEsquemaAtrasado` é, portanto, este comando, rodado da
 * máquina de dev (ou do contêiner do ingestor na própria stack): compara o que `drizzle.__drizzle_migrations` diz que
 * está aplicado com o journal de migrations (`packages/db/drizzle/meta/_journal.json`) e sai com 1 quando o dev está
 * atrás há mais que o limite (1 dia). Quem aplica é o `migrate` da stack do NAS (infra/nas-dev/compose.yml), a cada
 * atualização da stack a partir do git; o plano B é infra/ops/migrate-dev.sh.
 *
 * O journal comparado é o da MAIN (`git show origin/main:…`, depois de um `git fetch` do ref), não o do checkout: uma
 * migration só deste branch não é atraso do dev. Sem git (no contêiner, por exemplo) vale o journal do pacote
 * instalado, que é o da imagem. "Desde quando" é a hora do commit da main que acrescentou o .sql da migration; sem
 * git, a hora em que a migration foi gerada (`when` do journal), que é sempre anterior e portanto conservadora.
 *
 *   pnpm --filter @galaxie/ingestor gs dev:esquema [--ref origin/main] [--sem-fetch] [--limite-horas 24] [--json]
 *
 * Runbook: docs/runbooks/ambiente-de-dev.md › Esquema do dev atrasado.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { migrationsFolder, type Database, type Journal, type JournalEntry } from '@galaxie/db';
import { sql } from 'drizzle-orm';

export const LIMITE_HORAS = 24;
export const REF_PADRAO = 'origin/main';
/** Caminho do journal e das migrations dentro do repositório. */
export const JOURNAL_PATH = 'packages/db/drizzle/meta/_journal.json';

export type EsquemaEstado = 'em_dia' | 'pendente' | 'atrasado' | 'vazio' | 'adiante';

export interface MigrationFaltante {
  tag: string;
  /** Desde quando está na main (ou, sem git, quando foi gerada). */
  desde: Date;
  /** `false` quando `desde` veio do `when` do journal, não do commit da main. */
  commitDaMain: boolean;
}

export interface EsquemaResultado {
  estado: EsquemaEstado;
  /** Linhas em drizzle.__drizzle_migrations. */
  aplicadas: number;
  /** Entradas do journal comparado. */
  journal: number;
  ultimaDoJournal: string | null;
  ultimaAplicada: string | null;
  /** As que o migrator vai aplicar: `when` maior que o da última aplicada (o critério do próprio Drizzle). */
  faltam: MigrationFaltante[];
  /**
   * No journal, sem linha no banco e com `when` anterior ao da última aplicada: o migrator NÃO as aplica (journal.ts
   * explica). Histórico de migration renumerada ou regerada; só informação, não é atraso.
   */
  puladas: string[];
  /** `created_at` aplicados que o journal não conhece (histórico, ou checkout atrás do banco). Só informação. */
  desconhecidas: number[];
  /** Idade da migration mais antiga que falta, em horas (null sem faltante). */
  atrasoHoras: number | null;
  limiteHoras: number;
}

export interface EsquemaInput {
  journal: Journal;
  /** `created_at` de cada linha de drizzle.__drizzle_migrations (null: a tabela não existe). */
  aplicadas: number[] | null;
  /** Hora do commit da main que acrescentou a migration; null = sem git para saber. */
  entrouNaMain: ((tag: string) => Date | null) | null;
  now: Date;
  limiteHoras?: number;
}

/** A decisão, sem banco nem git: tudo vem de `input`. */
export function avaliarEsquema(input: EsquemaInput): EsquemaResultado {
  const limiteHoras = input.limiteHoras ?? LIMITE_HORAS;
  const entries = input.journal.entries;
  const porWhen = new Map(entries.map((e) => [e.when, e]));
  const aplicadas = input.aplicadas ?? [];
  const aplicadasSet = new Set(aplicadas);
  const maiorAplicada = aplicadas.length ? Math.max(...aplicadas) : null;
  // o migrator do Drizzle só aplica a migration cujo `when` passa do `created_at` da última aplicada
  const faltam = entries
    .filter((e) => maiorAplicada === null || e.when > maiorAplicada)
    .map((e) => desdeQuando(e, input.entrouNaMain))
    .sort((a, b) => a.desde.getTime() - b.desde.getTime());
  const puladas = entries
    .filter((e) => maiorAplicada !== null && e.when <= maiorAplicada && !aplicadasSet.has(e.when))
    .map((e) => e.tag);
  const desconhecidas = aplicadas.filter((w) => !porWhen.has(w)).sort((a, b) => a - b);
  const ultimaAplicada =
    maiorAplicada === null ? null : (porWhen.get(maiorAplicada)?.tag ?? `when ${maiorAplicada}`);
  const ultimaDoJournal = entries.at(-1) ?? null;
  const atrasoHoras = faltam.length
    ? Math.max(0, (input.now.getTime() - faltam[0]!.desde.getTime()) / 3_600_000)
    : null;

  let estado: EsquemaEstado;
  if (input.aplicadas === null || aplicadas.length === 0) estado = 'vazio';
  else if (faltam.length) estado = atrasoHoras! > limiteHoras ? 'atrasado' : 'pendente';
  else if (ultimaDoJournal && maiorAplicada! > ultimaDoJournal.when) estado = 'adiante';
  else estado = 'em_dia';

  return {
    estado,
    aplicadas: aplicadas.length,
    journal: entries.length,
    ultimaDoJournal: ultimaDoJournal?.tag ?? null,
    ultimaAplicada,
    faltam,
    puladas,
    desconhecidas,
    atrasoHoras,
    limiteHoras,
  };
}

function desdeQuando(e: JournalEntry, entrouNaMain: EsquemaInput['entrouNaMain']): MigrationFaltante {
  const commit = entrouNaMain?.(e.tag) ?? null;
  return commit
    ? { tag: e.tag, desde: commit, commitDaMain: true }
    : { tag: e.tag, desde: new Date(e.when), commitDaMain: false };
}

/** Código de saída do comando: 0 em dia (ou dentro do prazo), 1 atrasado, banco vazio ou leitura que falhou. */
export function codigoDeSaida(estado: EsquemaEstado): number {
  return estado === 'atrasado' || estado === 'vazio' ? 1 : 0;
}

export function formatarHoras(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.floor(horas / 24)} d ${Math.round(horas % 24)} h`;
}

/** Linhas do relatório em texto. */
export function relatorio(r: EsquemaResultado, origem: string): string[] {
  const lines = [
    `  journal (${origem})     ${r.journal} migrations${r.ultimaDoJournal ? `, última ${r.ultimaDoJournal}` : ''}`,
    `  aplicadas no banco     ${r.aplicadas}${r.ultimaAplicada ? `, última ${r.ultimaAplicada}` : ''}`,
  ];
  for (const f of r.faltam)
    lines.push(
      `  falta                  ${f.tag} (${f.commitDaMain ? 'na main desde' : 'gerada em'} ${f.desde.toISOString()})`,
    );
  if (r.puladas.length)
    lines.push(
      `  puladas                ${r.puladas.join(', ')}: sem linha no banco e com when anterior ao da última aplicada; o migrator não as aplica (histórico de renumeração, só informação)`,
    );
  if (r.desconhecidas.length)
    lines.push(
      `  desconhecidas          ${r.desconhecidas.length} linha(s) do banco que este journal não tem (histórico; só informação)`,
    );
  const atraso =
    r.atrasoHoras === null ? '' : ` há ${formatarHoras(r.atrasoHoras)} (limite ${r.limiteHoras} h)`;
  const estado: Record<EsquemaEstado, string> = {
    em_dia: 'em dia',
    pendente: `pendente${atraso}: o migrate da stack do NAS aplica na próxima atualização da stack (até ~5 min depois do merge)`,
    atrasado: `ATRASADO${atraso}: o migrate da stack do NAS não aplicou. Veja o contêiner migrate no Portainer; plano B: infra/ops/migrate-dev.sh`,
    vazio: 'VAZIO: o banco não tem migration nenhuma (drizzle.__drizzle_migrations ausente ou sem linhas)',
    adiante: 'à frente deste journal: atualize o checkout (git fetch) antes de concluir qualquer coisa',
  };
  lines.push(`  estado                 ${estado[r.estado]}`);
  return lines;
}

// ── leitura do banco e do git ──────────────────────────────────────────────────────────────────────────────────────

/** `created_at` de cada migration aplicada; null quando a tabela de controle do Drizzle não existe. */
export async function lerAplicadas(db: Database): Promise<number[] | null> {
  const [t] = (await db.execute(
    sql`select to_regclass('drizzle.__drizzle_migrations')::text as oid`,
  )) as unknown as { oid: string | null }[];
  if (!t?.oid) return null;
  const rows = (await db.execute(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at`,
  )) as unknown as { created_at: string | number }[];
  return rows.map((r) => Number(r.created_at));
}

/** Raiz do repositório a partir da pasta de migrations do pacote (packages/db/drizzle → raiz). */
export const REPO_ROOT = resolve(migrationsFolder, '..', '..', '..');

export interface GitJournal {
  journal: Journal;
  /** `origin/main` (do git) ou `pacote` (a pasta instalada, sem git). */
  origem: string;
  entrouNaMain: EsquemaInput['entrouNaMain'];
  avisos: string[];
}

function git(args: string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * O journal da main pelo git (com `git fetch` do ref antes, a não ser com `semFetch`) e a hora em que cada migration
 * entrou nela. Sem git, ou sem o ref, cai para o journal do pacote instalado e avisa.
 */
export function journalDaMain(ref = REF_PADRAO, semFetch = false): GitJournal {
  const avisos: string[] = [];
  try {
    if (!semFetch) {
      const [remote, ...branch] = ref.split('/');
      if (remote && branch.length) {
        try {
          git(['fetch', '--quiet', remote, branch.join('/')]);
        } catch (err) {
          avisos.push(
            `git fetch ${remote} ${branch.join('/')} falhou (${mensagem(err)}); ${ref} pode estar velho.`,
          );
        }
      }
    }
    const journal = JSON.parse(git(['show', `${ref}:${JOURNAL_PATH}`])) as Journal;
    const entrouNaMain = (tag: string): Date | null => {
      try {
        const out = git([
          'log',
          ref,
          '--diff-filter=A',
          '--format=%cI',
          '-1',
          '--',
          `packages/db/drizzle/${tag}.sql`,
        ]);
        const iso = out.trim();
        return iso ? new Date(iso) : null;
      } catch {
        return null;
      }
    };
    return { journal, origem: ref, entrouNaMain, avisos };
  } catch (err) {
    avisos.push(
      `sem o journal de ${ref} pelo git (${mensagem(err)}): comparando com o journal do pacote instalado.`,
    );
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
    return { journal, origem: 'pacote', entrouNaMain: null, avisos };
  }
}

function mensagem(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0]!.trim();
}

/** A URL sem a senha, para o relatório. */
export function urlSemSenha(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username}@` : ''}${u.host}${u.pathname}`;
  } catch {
    return url.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1@');
  }
}

export const USAGE_ESQUEMA = `Uso: gs dev:esquema [opções]

  Compara drizzle.__drizzle_migrations do banco (DATABASE_URL) com o journal de migrations da main.
  Sai com 1 quando o dev está atrasado há mais que o limite, ou sem migration nenhuma.

  --ref <ref>          ref do git com o journal (padrão ${REF_PADRAO}; sem git vale o journal do pacote)
  --sem-fetch          não roda git fetch antes
  --limite-horas N     atraso tolerado (padrão ${LIMITE_HORAS})
  --json               saída em JSON`;

export interface EsquemaIo {
  out: (line: string) => void;
  err: (line: string) => void;
  now?: Date;
  /** Quem lê o journal (injetável nos testes). */
  journal?: (ref: string, semFetch: boolean) => GitJournal;
  /** Quem lê o banco (injetável nos testes). */
  aplicadas?: (db: Database) => Promise<number[] | null>;
}

/** Roda `gs dev:esquema ...`. Devolve o código de saída (0 ok, 1 atrasado ou leitura que falhou, 2 uso errado). */
export async function runEsquemaCli(
  argv: readonly string[],
  db: Database,
  url: string,
  io: EsquemaIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        ref: { type: 'string', default: REF_PADRAO },
        'sem-fetch': { type: 'boolean', default: false },
        'limite-horas': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    io.err(mensagem(err));
    io.err(USAGE_ESQUEMA);
    return 2;
  }
  const { values } = parsed;
  if (values.help) {
    io.out(USAGE_ESQUEMA);
    return 0;
  }
  const limiteHoras = values['limite-horas'] === undefined ? LIMITE_HORAS : Number(values['limite-horas']);
  if (!Number.isFinite(limiteHoras) || limiteHoras < 0) {
    io.err(`--limite-horas espera um número de horas (veio "${values['limite-horas']}").`);
    return 2;
  }

  const fonte = (io.journal ?? journalDaMain)(values.ref, values['sem-fetch']);
  for (const a of fonte.avisos) io.err(`aviso: ${a}`);

  let aplicadas: number[] | null;
  try {
    aplicadas = await (io.aplicadas ?? lerAplicadas)(db);
  } catch (err) {
    io.err(`não deu para ler o banco ${urlSemSenha(url)}: ${mensagem(err)}`);
    return 1;
  }

  const r = avaliarEsquema({
    journal: fonte.journal,
    aplicadas,
    entrouNaMain: fonte.entrouNaMain,
    now: io.now ?? new Date(),
    limiteHoras,
  });
  if (values.json) io.out(JSON.stringify({ banco: urlSemSenha(url), origem: fonte.origem, ...r }, null, 2));
  else {
    io.out(`Esquema do dev: ${urlSemSenha(url)}`);
    for (const l of relatorio(r, fonte.origem)) io.out(l);
  }
  return codigoDeSaida(r.estado);
}
