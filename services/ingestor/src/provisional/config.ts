/**
 * Curadoria de jogos provisórios (`config/fixtures/provisional.yaml`): jogo anunciado oficialmente que o
 * fornecedor ainda não publicou. Schema, leitura e o instante de início (data e hora locais → UTC).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as z from 'zod';

const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug em minúsculas com hífens');
const ApiSportsId = z.number().int().positive();

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Data de calendário válida (rejeita 2026-02-30). */
const isCalendarDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const ProvisionalSide = z.union([
  z.strictObject({ team: ApiSportsId, name: z.string().min(1) }),
  z.strictObject({
    winner_of: z.strictObject({ stage: z.string().min(1), teams: z.tuple([ApiSportsId, ApiSportsId]) }),
    name: z.string().min(1).optional(),
  }),
]);
export type ProvisionalSide = z.infer<typeof ProvisionalSide>;

export const ProvisionalSource = z.strictObject({
  name: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  checked_at: z.string().refine(isCalendarDate, 'data AAAA-MM-DD').nullable().default(null),
});

export const ProvisionalFixture = z
  .strictObject({
    key: Slug,
    sport: Slug,
    competition: Slug,
    season: z.number().int().min(1900).max(2100),
    stage: z.string().min(1),
    home: ProvisionalSide,
    away: ProvisionalSide,
    date: z.string().refine(isCalendarDate, 'data AAAA-MM-DD'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horário HH:MM')
      .nullable(),
    timezone: z.string().refine(isTimeZone, 'fuso IANA inválido'),
    venue: z
      .strictObject({ id: ApiSportsId, name: z.string().min(1), city: z.string().nullable() })
      .nullable(),
    announced_by: z.string().min(1).nullable(),
    status: z.enum(['announced', 'cancelled']),
    origin: z.enum(['curated', 'agent']).default('curated'),
    sources: z.array(ProvisionalSource).min(1),
    note: z
      .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'chave de locale'), z.string().min(1))
      .nullable()
      .default(null),
  })
  .refine(
    (f) => JSON.stringify(f.home) !== JSON.stringify(f.away),
    'mandante e visitante não podem ser o mesmo lado',
  );
export type ProvisionalFixture = z.output<typeof ProvisionalFixture>;

export const ProvisionalFile = z
  .strictObject({ schema_version: z.literal(1), fixtures: z.array(ProvisionalFixture) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.fixtures.forEach((f, i) => {
      if (seen.has(f.key))
        ctx.addIssue({ code: 'custom', path: ['fixtures', i, 'key'], message: `chave repetida: ${f.key}` });
      seen.add(f.key);
    });
  });
export type ProvisionalFile = z.output<typeof ProvisionalFile>;

export class ProvisionalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionalConfigError';
  }
}

/** `config/fixtures/provisional.yaml` do monorepo (mesma profundidade em src/ e dist/). */
export function defaultProvisionalPath(): string {
  return (
    process.env.PROVISIONAL_FIXTURES_PATH ??
    fileURLToPath(new URL('../../../../config/fixtures/provisional.yaml', import.meta.url))
  );
}

/** Valida o YAML já lido; erro de schema vira uma mensagem por problema, com o caminho do campo. */
export function parseProvisionalFile(doc: unknown): ProvisionalFixture[] {
  const parsed = ProvisionalFile.safeParse(doc);
  if (!parsed.success)
    throw new ProvisionalConfigError(
      'config/fixtures/provisional.yaml inválido:\n' +
        parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n'),
    );
  return parsed.data.fixtures;
}

export async function loadProvisionalFixtures(
  path = defaultProvisionalPath(),
): Promise<ProvisionalFixture[]> {
  return parseProvisionalFile(parse(await readFile(path, 'utf8')));
}

/** Diferença (ms) entre o relógio local de `timeZone` e o UTC no instante `at`. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - at;
}

/** Data e hora locais (`2026-11-28`, `17:00`) no fuso IANA → instante UTC. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // duas passadas acertam o offset também perto da troca de horário de verão
  let at = wall - zoneOffsetMs(wall, timeZone);
  at = wall - zoneOffsetMs(at, timeZone);
  return new Date(at);
}

/** Horário guardado quando só a data é oficial: meio-dia local mantém o mesmo dia em todo o continente. */
export const UNCONFIRMED_TIME = '12:00';

/** Início do jogo provisório: horário anunciado ou, a confirmar, meio-dia local. */
export function provisionalKickoff(f: Pick<ProvisionalFixture, 'date' | 'time' | 'timezone'>): {
  startsAt: Date;
  timeConfirmed: boolean;
} {
  return {
    startsAt: zonedInstant(f.date, f.time ?? UNCONFIRMED_TIME, f.timezone),
    timeConfirmed: f.time != null,
  };
}
