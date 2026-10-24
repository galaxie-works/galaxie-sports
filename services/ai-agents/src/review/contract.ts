/**
 * Conferência da edição contra os contratos da API (`@galaxie/contracts`): o conteúdo editado vira o
 * pedaço da resposta que o item preenche (os mesmos nomes de campo do contrato) e passa pelo schema
 * Zod. Só conta o problema que a edição introduz: o que já falhava antes dela não é culpa da sugestão
 * (e uma diferença de montagem daqui não recusa uma edição boa).
 */
import {
  CopySuggestion,
  Derby,
  DerbyAllTime,
  DerbySummary,
  GlossaryTerm,
  TeamSemantic,
} from '@galaxie/contracts';
import type { ReviewKind } from '@galaxie/knowledge';

/** Resultado de safeParse (sem depender do zod aqui). */
type Parsed = { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const opt = (v: unknown) => (v === undefined ? null : v);

const TeamFields = TeamSemantic.pick({
  official_name: true,
  short_name: true,
  abbreviation: true,
  city: true,
  region: true,
  colors: true,
  nicknames: true,
  mascot: true,
  fans: true,
  rallying_cries: true,
  stadium: true,
  identity: true,
}).partial();

const teamBody = (c: Rec) => {
  const names = rec(c.names);
  const fans = c.fans === undefined ? undefined : rec(c.fans);
  const stadium = c.stadium === undefined ? undefined : c.stadium === null ? null : rec(c.stadium);
  return {
    ...(c.names !== undefined
      ? { official_name: names.official, short_name: names.short, abbreviation: opt(names.abbreviation) }
      : {}),
    ...(c.city !== undefined ? { city: c.city } : {}),
    ...(c.region !== undefined ? { region: c.region } : {}),
    ...(c.colors !== undefined ? { colors: c.colors } : {}),
    ...(c.nicknames !== undefined ? { nicknames: c.nicknames } : {}),
    ...(c.mascot !== undefined ? { mascot: c.mascot } : {}),
    ...(fans ? { fans: { demonym: opt(fans.demonym), group_nicknames: fans.group_nicknames ?? [] } } : {}),
    ...(c.rallying_cries !== undefined ? { rallying_cries: c.rallying_cries } : {}),
    ...(stadium !== undefined
      ? {
          stadium: stadium && {
            name: stadium.name,
            nicknames: stadium.nicknames ?? [],
            former_names: stadium.former_names ?? [],
            city: opt(stadium.city),
          },
        }
      : {}),
    ...(c.identity !== undefined ? { identity: c.identity } : {}),
  };
};

const DerbyFields = DerbySummary.pick({ name: true, aliases: true, scope: true, intensity: true })
  .extend(Derby.pick({ labels: true, first_match: true, origin: true, trivia: true, sources: true }).shape)
  .partial();

const derbyBody = (c: Rec) =>
  Object.fromEntries(
    ['name', 'aliases', 'scope', 'intensity', 'labels', 'first_match', 'origin', 'trivia', 'sources']
      .filter((k) => c[k] !== undefined)
      .map((k) => [k, c[k]]),
  );

const allTimeBody = (c: Rec) => {
  const a = rec(c.all_time);
  return {
    matches: a.matches,
    draws: a.draws,
    teams: (Array.isArray(a.teams) ? a.teams : []).map((t) => {
      const r = rec(t);
      return { slug: r.team, wins: r.wins, goals: opt(r.goals) };
    }),
    basis: a.basis ?? 'all',
    as_of: a.as_of,
    sources: a.sources,
    review_status: 'approved',
  };
};

const CopyFields = CopySuggestion.shape.selection
  .unwrap()
  .pick({ template: true, intent: true, tone: true, confidence: true });

const glossaryBody = (c: Rec) => ({
  key: c.key,
  term: c.term,
  meaning: c.meaning,
  example: opt(c.example),
  category: c.category,
  copy_intents: c.copy_intents ?? [],
  requires: opt(c.requires),
  note: opt(c.note),
  sources: c.sources ?? [],
  review_status: 'approved',
});

const TranslationTeam = TeamSemantic.pick({ identity: true, mascot: true, colors: true }).partial();
const TranslationDerby = Derby.pick({ origin: true, trivia: true }).partial();

function check(kind: ReviewKind, content: Rec, parentKind: 'team' | 'derby' | null): Parsed | null {
  switch (kind) {
    case 'team':
      return TeamFields.safeParse(teamBody(content));
    case 'derby':
      return DerbyFields.safeParse(derbyBody(content));
    case 'all-time':
      return DerbyAllTime.safeParse(allTimeBody(content));
    case 'copy':
      return CopyFields.safeParse({
        template: content.template,
        intent: content.intent,
        tone: content.tone,
        confidence: content.confidence,
      });
    case 'glossary':
      return GlossaryTerm.safeParse(glossaryBody(content));
    case 'translation': {
      const { note: _n, fans: _f, ...texts } = content;
      return parentKind === 'derby' ? TranslationDerby.safeParse(texts) : TranslationTeam.safeParse(texts);
    }
    case 'competition':
    case 'editorial':
      // sem contrato próprio do item (o da API é montado na leitura): o schema da base semântica confere os campos
      return null;
  }
}

const issues = (r: Parsed | null) =>
  r && !r.success
    ? (r.error?.issues ?? []).map((i) => `${i.path.map(String).join('.') || '(raiz)'}: ${i.message}`)
    : [];

/** Problemas de contrato que a edição introduz (os que o conteúdo atual já tinha não contam). */
export function contractProblems(
  kind: ReviewKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  parentKind: 'team' | 'derby' | null = null,
): string[] {
  const old = new Set(issues(check(kind, before, parentKind)));
  return issues(check(kind, after, parentKind))
    .filter((i) => !old.has(i))
    .map((i) => `contrato da API: ${i}`);
}
