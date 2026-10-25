import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CopyQuery, type CopySuggestion } from '@galaxie/contracts';
import { copyTemplate, participant, type Database } from '@galaxie/db';
import {
  copyPermission,
  selectCopy,
  type CopyPlaceholder,
  type CopyTemplate,
  type ReviewStatus,
} from '@galaxie/knowledge';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { resolveLocale } from '../../i18n.js';
import { parseInput, UUID_RE } from '../../util.js';
import { loadTeamNames } from '../../teams/display-name.js';
import { effectiveMinReview, findProfile, meetsReview, nicknamesFor, profileName } from './semantic.js';

const MODULE = { module: 'semantic' } as const;

/**
 * GET /v1/copy (docs/06 §4 e §5, issue #43): microcopy do mercado escolhida por `selectCopy`, com o
 * copy_permission aplicado — afinidade inferida só recebe copy informativa; rivalidade só com rival
 * declarado. Os templates vêm de semantic.copy_template (seed da base); não há fallback entre locales.
 */
export async function copyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/copy', { config: MODULE }, async (request, reply) => {
    const query = parseInput(CopyQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.semantic,
      vary: [locale, min],
      load: async () => {
        const db = requireDb(ctx);
        const vars: Partial<Record<CopyPlaceholder, string | number>> = {};
        let hasVars = false;
        if (query.team) {
          const t = await teamVars(db, query.team, locale, min);
          vars.team = t.name;
          if (t.nickname) vars.nickname = t.nickname;
          hasVars = true;
        }
        if (query.rival) {
          vars.rival = (await teamVars(db, query.rival, locale, min)).name;
          hasVars = true;
        }
        if (query.minutes !== undefined) {
          vars.minutes = query.minutes;
          hasVars = true;
        }

        const rows = await db
          .select()
          .from(copyTemplate)
          .where(and(eq(copyTemplate.locale, locale), eq(copyTemplate.sport, query.sport)));
        const templates: CopyTemplate[] = rows.map((r) => ({
          key: r.key,
          locale: r.locale,
          sport: r.sport,
          intent: r.copyIntent as CopyTemplate['intent'],
          tone: r.toneIntensity as CopyTemplate['tone'],
          template: r.template,
          affinityType: r.affinityType as CopyTemplate['affinityType'],
          affinitySource: r.affinitySource as CopyTemplate['affinitySource'],
          momentum: r.momentum as CopyTemplate['momentum'],
          competitionContext: r.competitionContext as CopyTemplate['competitionContext'],
          confidence: r.confidence as CopyTemplate['confidence'],
          reviewStatus: r.reviewStatus,
        }));

        const picked = selectCopy(
          {
            locale,
            sport: query.sport,
            intent: query.intent,
            tone: query.tone as CopyTemplate['tone'],
            affinityType: query.affinity_type ?? null,
            affinitySource: query.affinity_source ?? null,
            momentum: query.momentum ?? null,
            context: query.context ?? null,
            minReviewStatus: min as ReviewStatus,
            ...(hasVars ? { vars } : {}),
            ...(query.variant ? { variantSeed: query.variant } : {}),
          },
          templates,
        );
        const permission = picked?.permission ?? copyPermission(query.affinity_type, query.affinity_source);
        const body: CopySuggestion = {
          locale,
          permission: {
            allowed_intents: [...permission.allowedIntents],
            max_tone: permission.maxTone,
            rule: permission.rule,
          },
          selection: picked
            ? {
                key: picked.template.key,
                template: picked.template.template,
                text: picked.text,
                intent: picked.intent,
                tone: picked.template.tone,
                max_tone: picked.tone,
                downgraded: picked.downgraded,
                confidence: picked.template.confidence,
                review_status: picked.template.reviewStatus,
              }
            : null,
        };
        return { body, tags: ['copy_template', 'team_profile'] };
      },
    });
  });
}

/**
 * Nome (e apelido do mercado) do time citado: perfil semântico publicado; sem perfil publicado, o nome do
 * participante do core (UUID) — sem apelido, para nunca vazar conteúdo não revisado.
 */
async function teamVars(
  db: Database,
  key: string,
  locale: string,
  min: ReviewStatus,
): Promise<{ name: string; nickname: string | null }> {
  const p = await findProfile(db, key);
  if (p && meetsReview(p.reviewStatus, min))
    return { name: profileName(p, locale), nickname: nicknamesFor(p, locale)[0] ?? null };
  if (UUID_RE.test(key)) {
    const [row] = await db
      .select({ name: participant.name, shortName: participant.shortName })
      .from(participant)
      .where(eq(participant.id, key))
      .limit(1);
    if (row) {
      // sem perfil publicado: o nome do fornecedor com o corretor de acentos (mesma regra das outras rotas)
      const names = await loadTeamNames(db, [key], { locale, minReview: min });
      return { name: names.name(key, row.name), nickname: null };
    }
  }
  throw problems.notFound('Time');
}
