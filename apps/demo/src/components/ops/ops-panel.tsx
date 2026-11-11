'use client';

import { SCHEDULED_JOBS, scheduleKey, settingDef } from '@galaxie/runtime-config';
import { Activity, Bot, Gauge, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition, type ReactNode } from 'react';

import { checkAiCreditNow, runJobNow } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { Badge } from '@/components/reui/badge';
import { SettingsSection } from '@/components/settings';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { ModelAgentCards } from '@/components/settings/blocks/ai-usage';
import { GithubIntegration } from '@/components/settings/blocks/integrations';
import { JobsGrid, type JobRow } from '@/components/settings/blocks/jobs-grid';
import { AI_MODEL_KEYS, PLAN_SPORT_KEYS, POSTGAME_SPORT_KEYS } from '@/components/settings/blocks/logic';
import { PlanTable, PostgameTable } from '@/components/settings/blocks/sport-tables';
import { CredentialsList, ServicesStatusList } from '@/components/settings/blocks/status-panels';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import type { JobStatus, OpsSetting, OpsSnapshot } from '@/lib/ops/types';

import { AiPolicyCard } from './ai-policy-card';
import { MirrorTab } from './mirror-tab';
import { aiStateText, displayValue, formatDuration, settingText, tokenUsage } from './format';
import { QualityTab } from './quality-tab';
import { SettingRow, useOpsAction } from './setting-row';
import { TasksTab } from './tasks-tab';
import { useScrollToHashOnMount } from './use-scroll-to-hash';
import { YoutubeQuotaCard, YoutubeYieldPanel } from './youtube-quota';

import { SETTINGS_VIEWS, type PanelBlock, type SettingsView } from '@/lib/ops/panel-tabs';
import { settingBlock } from '@/lib/ops/setting-page';

import { SettingLinks } from './setting-link';

export { SETTINGS_VIEWS, type SettingsView };

/** Editadas pelo cartão Política de IA (sliders), fora da lista de flags da seção. */
const AI_POLICY_KEYS = new Set(['AI_BAND_SHARES', 'AI_DAILY_USD_BUDGET', 'AI_P0_MIN_AUDIENCE']);

/** Modelos em uso que as páginas das features mostram com link para IA interna (A3, #1070). */
const WTW_MODEL_KEYS = ['AI_MATCH_CHANNEL_MODEL', 'AI_RIGHTS_MODEL'] as const;
/** A pesquisa e a revisita da grade usam os níveis de pesquisa e leve dos agentes. */
const LINEUP_MODEL_KEYS = ['AI_MODEL_RESEARCH', 'AI_MODEL_LIGHT'] as const;
/** Chaves que as páginas mostram como "configurada ou faltando", com link para Credenciais (A4). */
const AI_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'] as const;

interface Ctx {
  snapshot: OpsSnapshot;
  timeZone: string;
}

/**
 * Uma página de Ajustes feita do painel de Operação (#1069): os blocos do item (`SETTINGS_VIEWS`), na ordem. Página
 * com um bloco só mostra o bloco direto; com mais de um, cada um vira uma seção com título. Cada bloco leva a âncora do
 * próprio nome (`/ajustes/fornecedor#sports`), para os links antigos e a busca.
 */
export function OpsPanel({
  snapshot,
  timeZone,
  view,
  relatedChannels,
}: Ctx & {
  view: SettingsView;
  /** Controle dos canais nos vídeos relacionados (renderizado no servidor, com a busca e o filtro da URL). */
  relatedChannels?: ReactNode;
}) {
  const { t } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useScrollToHashOnMount();

  const content: Record<PanelBlock, () => ReactNode> = {
    status: () => <StatusTab snapshot={snapshot} timeZone={timeZone} />,
    quality: () => (
      <QualityTab
        quality={snapshot.quality}
        timeZone={timeZone}
        action={(() => {
          const job = snapshot.jobs.find((j) => j.name === 'data-quality');
          return job ? <RunNowButton job={job} /> : null;
        })()}
      />
    ),
    ai: () => (
      <>
        <AiPolicyCard
          key={`${snapshot.llm.usdBudget}:${snapshot.llm.p0MinAudience}:${Object.values(snapshot.llm.bandShares).join(',')}`}
          llm={snapshot.llm}
        />
        <SectionCard
          block="ai"
          filter={(key) => !AI_POLICY_KEYS.has(key)}
          snapshot={snapshot}
          timeZone={timeZone}
        />
        <SettingLinks kind="keys" keys={AI_KEYS} snapshot={snapshot} />
      </>
    ),
    related: () => (
      <>
        {snapshot.youtube ? (
          <>
            <YoutubeQuotaCard youtube={snapshot.youtube} timeZone={timeZone} />
            <YoutubeYieldPanel youtube={snapshot.youtube} timeZone={timeZone} />
          </>
        ) : null}
        {relatedChannels}
        <SectionCard block="related" snapshot={snapshot} timeZone={timeZone} />
        <SettingLinks kind="keys" keys={['YOUTUBE_API_KEY']} snapshot={snapshot} />
      </>
    ),
    sports: () => <SectionCard block="sports" snapshot={snapshot} timeZone={timeZone} />,
    schedule: () => <ScheduleTab snapshot={snapshot} timeZone={timeZone} />,
    tasks: () => <TasksTab tasks={snapshot.tasks} timeZone={timeZone} now={snapshot.generatedAt} />,
    provider: () => (
      <>
        <SectionCard block="provider" snapshot={snapshot} timeZone={timeZone} />
        <SettingLinks kind="keys" keys={['APISPORTS_KEY']} snapshot={snapshot} />
      </>
    ),
    credentials: () => <SectionCard block="credentials" snapshot={snapshot} timeZone={timeZone} />,
    mirror: () => <MirrorTab snapshot={snapshot} timeZone={timeZone} />,
    suggestions: () => (
      <>
        {/* cartão de integração (#1077): o liga/desliga aberto quando conectado; repo e token gravados juntos nele */}
        <GithubIntegration snapshot={snapshot} timeZone={timeZone} />
      </>
    ),
    history: () => <HistoryTab snapshot={snapshot} timeZone={timeZone} />,
    live: () => <SectionCard block="live" snapshot={snapshot} timeZone={timeZone} />,
    postgame: () => <SectionCard block="postgame" snapshot={snapshot} timeZone={timeZone} />,
    wtw: () => (
      <>
        <SectionCard block="wtw" snapshot={snapshot} timeZone={timeZone} />
        <SettingLinks kind="models" keys={WTW_MODEL_KEYS} snapshot={snapshot} />
      </>
    ),
    lineup: () => (
      <>
        <SectionCard block="lineup" snapshot={snapshot} timeZone={timeZone} />
        <SettingLinks kind="models" keys={LINEUP_MODEL_KEYS} snapshot={snapshot} />
      </>
    ),
    assets: () => <SectionCard block="assets" snapshot={snapshot} timeZone={timeZone} />,
    cosmos: () => <SectionCard block="cosmos" snapshot={snapshot} timeZone={timeZone} />,
  };
  const blocks: readonly PanelBlock[] = SETTINGS_VIEWS[view];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-3xl text-sm">{T.views[view]}</p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {fill(T.page.generatedAt, { when: f.time(snapshot.generatedAt) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? <Spinner /> : <RefreshCw />}
            {T.page.refresh}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-8">
        {blocks.map((id) =>
          blocks.length > 1 ? (
            <div key={id} id={id} className="scroll-mt-20">
              <SettingsSection title={T.tabs[id]}>
                <div className="flex flex-col gap-4">{content[id]()}</div>
              </SettingsSection>
            </div>
          ) : (
            <div key={id} id={id} className="flex scroll-mt-20 flex-col gap-4">
              {content[id]()}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

const effective = (snapshot: OpsSnapshot, key: string) =>
  snapshot.settings.find((s) => s.key === key)?.value ?? null;

/** Linhas de ajuste da seção (padrão settings-3, #1074) numa moldura, com título e descrição. */
function RowsFrame({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Frame>
      {title ? (
        <FrameHeader>
          <FrameTitle>{title}</FrameTitle>
          {description ? <FrameDescription>{description}</FrameDescription> : null}
        </FrameHeader>
      ) : null}
      <FramePanel className="p-0">{children}</FramePanel>
    </Frame>
  );
}

/** Título e descrição de cada bloco de linhas (o das sugestões é o texto da seção `feedback` do registro). */
type SectionBlock = Exclude<PanelBlock, 'status' | 'quality' | 'schedule' | 'tasks' | 'mirror' | 'history'>;
const sectionTextKey = (block: SectionBlock) => (block === 'suggestions' ? 'feedback' : block);

/**
 * As flags de uma seção. Cada uma no bloco dela (#1074 a #1078): as linhas comuns em `SettingRow`; o pós-jogo e o
 * plano de cada esporte numa linha por esporte; os modelos de IA num cartão por agente; os segredos na lista de
 * credenciais (só "configurada ou faltando"). O salvamento é o de sempre, uma chave por vez.
 */
function SectionCard({
  block,
  snapshot,
  timeZone,
  filter,
}: Ctx & {
  block: SectionBlock;
  /** Só parte das flags do bloco (ex.: só o liga/desliga das sugestões). */
  filter?: (key: string) => boolean;
}) {
  const { t } = useI18n();
  const T = t.ops;
  // cada ajuste mora em um lugar só (`settingPage`, #1070): o bloco escolhe as linhas pela tabela, não pela seção
  const settings = snapshot.settings.filter(
    (s) => settingBlock(s.key) === block && (!filter || filter(s.key)),
  );
  const text = T.sections[sectionTextKey(block)];
  const editable = settings.filter((s) => settingDef(s.key)!.type !== 'secret');
  const secrets = settings.filter((s) => settingDef(s.key)!.type === 'secret');
  const postgame = editable.filter((s) => POSTGAME_SPORT_KEYS.has(s.key));
  const postgameCap = postgame.length ? editable.find((s) => s.key === 'POSTGAME_MAX_CALLS_DAY') : undefined;
  const plans = editable.filter((s) => PLAN_SPORT_KEYS.has(s.key));
  const models = editable.filter((s) => AI_MODEL_KEYS.has(s.key));
  const rows = editable.filter(
    (s) =>
      !POSTGAME_SPORT_KEYS.has(s.key) &&
      !PLAN_SPORT_KEYS.has(s.key) &&
      !AI_MODEL_KEYS.has(s.key) &&
      s !== postgameCap,
  );
  const inheritPlan = effective(snapshot, 'APISPORTS_PLAN');
  const row = (s: OpsSetting) => (
    <SettingRow
      key={`${s.key}:${s.source}:${s.value}`}
      setting={s}
      timeZone={timeZone}
      now={snapshot.generatedAt}
      inheritPlan={inheritPlan}
    />
  );
  // o rascunho das tabelas volta ao gravado quando o snapshot muda (depois de salvar)
  const version = (list: OpsSetting[]) => list.map((s) => `${s.key}=${s.source}:${s.value}`).join('|');
  // só a tabela (plano por esporte, credenciais): ela leva o título da seção
  const onlyTable = !rows.length && !models.length;
  return (
    <>
      {rows.length || models.length ? (
        <RowsFrame title={text.title} description={text.description}>
          {rows.map(row)}
          <ModelAgentCards settings={models} timeZone={timeZone} now={snapshot.generatedAt} />
        </RowsFrame>
      ) : null}
      {postgame.length ? (
        <PostgameTable
          key={version(postgame)}
          settings={postgame}
          before={postgameCap ? <div className="border-b">{row(postgameCap)}</div> : null}
        />
      ) : null}
      {plans.length ? (
        <PlanTable
          key={version(plans)}
          settings={plans}
          inheritPlan={inheritPlan}
          {...(onlyTable && !postgame.length ? { title: text.title, description: text.description } : {})}
        />
      ) : null}
      {secrets.length ? (
        <CredentialsList
          settings={secrets}
          aiProvider={effective(snapshot, 'AI_PROVIDER')}
          {...(onlyTable && !postgame.length && !plans.length
            ? { title: text.title, description: text.description }
            : {})}
        />
      ) : null}
    </>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────────────────────

function StatusTab({ snapshot, timeZone }: Ctx) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ServicesStatusList services={snapshot.services} timeZone={timeZone} now={snapshot.generatedAt} />
      <CreditCard snapshot={snapshot} timeZone={timeZone} />
      <QuotaCard snapshot={snapshot} timeZone={timeZone} />
      <LlmCard snapshot={snapshot} timeZone={timeZone} />
      {snapshot.youtube ? <YoutubeQuotaCard youtube={snapshot.youtube} timeZone={timeZone} /> : null}
      <div className="xl:col-span-2">
        <JobsOverview snapshot={snapshot} timeZone={timeZone} />
      </div>
    </div>
  );
}

function CardShell({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Frame>
      <FramePanel className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-4" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
            </div>
          </div>
          {action}
        </div>
        {children}
      </FramePanel>
    </Frame>
  );
}

function CreditCard({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const { pending, run } = useOpsAction();
  const c = snapshot.credit;
  const codes = T.status.creditCodes;
  return (
    <CardShell
      icon={ShieldCheck}
      title={T.status.credit}
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={pending || snapshot.creditPending}
          onClick={() => run(() => checkAiCreditNow(), T.feedback.queued)}
        >
          {pending ? <Spinner /> : <RefreshCw />}
          {T.actions.checkCredit}
        </Button>
      }
    >
      {c ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={c.status === 'pass' ? 'success-light' : 'warning-light'}>
              {c.status === 'pass' ? T.status.creditPass : T.status.creditWarn}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {fill(T.status.creditChecked, {
                provider: c.provider ?? '',
                model: c.model ?? '',
                when: f.relative(c.checkedAt, Date.parse(snapshot.generatedAt)),
              })}
            </span>
          </div>
          <p className="text-xs">
            {fill(codes[c.code as keyof typeof codes] ?? codes.http, {
              http: c.http ?? '',
              error: c.error ?? '',
            })}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{T.status.creditNever}</p>
      )}
      {snapshot.creditPending ? (
        <p className="text-muted-foreground text-xs">{T.status.creditPending}</p>
      ) : null}
    </CardShell>
  );
}

function QuotaCard({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const n = (v: number) => f.number(v);
  return (
    <CardShell
      icon={Gauge}
      title={T.status.quota}
      description={fill(T.status.quotaDay, { day: snapshot.dayUtc })}
    >
      {snapshot.quota.every((q) => q.totalUsed === 0 && q.providerUsed === null) ? (
        <p className="text-muted-foreground text-sm">{T.status.noQuota}</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {snapshot.quota.map((q) => {
          const used = Math.max(q.totalUsed, q.providerUsed ?? 0);
          const pct = q.dailyLimit ? Math.min(100, (used / q.dailyLimit) * 100) : 0;
          const plan = settingDef('APISPORTS_PLAN')!;
          return (
            <div key={q.api} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {T.apis[q.api as keyof typeof T.apis] ?? q.api}
                  {q.plan ? (
                    <span className="text-muted-foreground font-normal">
                      {' '}
                      · {displayValue(T, plan, q.plan, { locale })}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs tabular-nums">
                  {q.dailyLimit
                    ? fill(T.status.quotaUsed, { used: n(used), limit: n(q.dailyLimit) })
                    : fill(T.status.quotaNoLimit, { used: n(used) })}
                </span>
              </div>
              <Progress value={pct} />
              <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                {(['DAILY', 'LIVE', 'BOOTSTRAP', 'ADHOC'] as const).map((p) => (
                  <span key={p}>
                    {T.status.priorities[p]} {n(q.used[p] ?? 0)}
                    {q.planned[p] !== undefined
                      ? ` (${fill(T.status.planned, { n: n(q.planned[p]!) })})`
                      : ''}
                  </span>
                ))}
                {q.providerUsed !== null && q.providerLimit !== null ? (
                  <span>
                    {fill(T.status.quotaProvider, {
                      used: n(q.providerUsed),
                      limit: n(q.providerLimit),
                      when: q.capturedAt ? f.time(q.capturedAt) : '—',
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

function LlmCard({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const {
    totals,
    byAgent,
    budget,
    usdBudget,
    agentUsdBudgets,
    agentUsdOrigins,
    agentDefaultUsdBudget,
    maxSearchesPerCall,
    status,
    agentStatus,
    invalid,
  } = snapshot.llm;
  // como o serviço: o pool próprio do assets fica fora da soma contra o teto global de tokens
  const tokenCount = tokenUsage(byAgent, budget);
  const tokens = tokenCount.counted;
  const usd = (v: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
  return (
    <CardShell
      icon={Bot}
      title={T.status.llm}
      description={fill(T.status.llmDay, {
        day: snapshot.llm.budgetDay,
        start: snapshot.llm.day.start,
        timeZone: snapshot.llm.day.timeZone,
      })}
    >
      <div className="flex flex-col gap-1.5">
        <span
          className={
            status === 'off' || invalid.length
              ? 'text-destructive text-sm font-medium'
              : 'text-sm font-medium'
          }
        >
          {fill(T.status.aiState, {
            // flag de IA inválida: o serviço recusa a configuração e nenhum agente usa IA
            state: invalid.length
              ? T.status.aiInvalidState
              : aiStateText(T, locale, { status, usdPerDay: usdBudget, tokensPerDay: budget }),
          })}
        </span>
        {status === 'off' && Object.values(agentStatus).includes('on') ? (
          // AI_STATUS=off é a chave geral: agente=on não religa o agente
          <span className="text-warning text-xs">
            {fill(T.status.aiAgentOnIgnored, {
              agents: Object.keys(agentStatus)
                .filter((a) => agentStatus[a] === 'on')
                .join(', '),
            })}
          </span>
        ) : null}
        {invalid.length ? (
          <span className="text-destructive text-xs">
            {fill(T.status.aiInvalid, { keys: invalid.join(', ') })}
          </span>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium tabular-nums">
            {usdBudget !== null
              ? fill(T.status.llmUsd, { used: usd(totals.costUsd), budget: usd(usdBudget) })
              : fill(T.status.llmUsdUnlimited, { used: usd(totals.costUsd) })}
          </span>
          <span className="text-xs tabular-nums">
            {fill(T.status.llmCalls, {
              calls: f.number(totals.calls),
              searches: f.number(totals.webSearches),
            })}
          </span>
        </div>
        {usdBudget !== null ? <Progress value={Math.min(100, (totals.costUsd / usdBudget) * 100)} /> : null}
        <span className="text-muted-foreground text-xs tabular-nums">
          {budget
            ? fill(T.status.llmTokens, { used: f.number(tokens), budget: f.number(budget) })
            : fill(T.status.llmTokensUnlimited, { used: f.number(tokens) })}
        </span>
        {tokenCount.pools
          .filter((p) => p.used > 0)
          .map((p) => (
            <span key={p.agent} className="text-muted-foreground text-xs tabular-nums">
              {p.limit !== null
                ? fill(T.status.llmTokenPool, {
                    agent: p.agent,
                    used: f.number(p.used),
                    budget: f.number(p.limit),
                  })
                : fill(T.status.llmTokenPoolUnlimited, { agent: p.agent, used: f.number(p.used) })}
            </span>
          ))}
        {totals.errors ? (
          <span className="text-destructive text-xs">
            {plural(locale, totals.errors, T.status.llmErrors)}
          </span>
        ) : null}
        {totals.overSearchCap && maxSearchesPerCall !== null ? (
          <span className="text-warning text-xs">
            {plural(locale, totals.overSearchCap, T.status.llmOverSearchCap, { max: maxSearchesPerCall })}
          </span>
        ) : null}
      </div>
      {byAgent.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.status.agent}</TableHead>
              <TableHead className="text-right">{T.status.searchesColumn}</TableHead>
              <TableHead className="text-right">{T.status.tokensColumn}</TableHead>
              <TableHead className="text-right">{T.status.costColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byAgent.map((a) => {
              // agente fora da lista: o teto padrão (AI_AGENT_DEFAULT_USD_BUDGET), nunca sem teto
              const listed = Object.hasOwn(agentUsdBudgets, a.agent);
              const cap = listed ? (agentUsdBudgets[a.agent] ?? null) : agentDefaultUsdBudget;
              const off = status === 'off' || agentStatus[a.agent] === 'off';
              return (
                <TableRow key={a.agent}>
                  <TableCell className="font-mono text-xs">
                    {a.agent}
                    {off ? (
                      <Badge variant="secondary" className="ml-1.5">
                        {T.status.aiOff}
                      </Badge>
                    ) : cap !== null && a.costUsd >= cap ? (
                      <Badge variant="destructive-light" className="ml-1.5">
                        {T.status.llmAgentCapped}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.number(a.webSearches)}
                    {a.overSearchCap ? <span className="text-warning"> ({a.overSearchCap}!)</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.number(a.inputTokens + a.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {usd(a.costUsd)}
                    {cap !== null ? (
                      <span className="text-muted-foreground">
                        {' '}
                        / {usd(cap)}
                        {` (${listed ? T.status.llmCapOrigin[agentUsdOrigins[a.agent] ?? 'code'] : T.status.llmAgentDefaultCap})`}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">{T.status.llmNone}</p>
      )}
    </CardShell>
  );
}

// ── Jobs ──────────────────────────────────────────────────────────────────────────────────────

const RUN_VARIANT = {
  ok: 'success-light',
  budget_skipped: 'warning-light',
  interrupted: 'warning-light',
  error: 'destructive-light',
  running: 'info-light',
} as const;

function LastRun({ job, timeZone, now }: { job: JobStatus; timeZone: string; now: string }) {
  const { t, locale } = useI18n();
  const T = t.ops.jobs;
  const f = useFormatters(timeZone);
  const at = Date.parse(now);
  const last = job.last;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={last ? (RUN_VARIANT[last.status as keyof typeof RUN_VARIANT] ?? 'secondary') : 'secondary'}
        >
          {last ? (T.status[last.status as keyof typeof T.status] ?? last.status) : T.status.never}
        </Badge>
        {last ? (
          <span className="text-muted-foreground">
            {f.relative(last.startedAt, at)}
            {last.durationMs !== null
              ? ` · ${fill(T.duration, { duration: formatDuration(locale, last.durationMs) })}`
              : ''}
            {last.trigger ? ` · ${T.triggers[last.trigger as keyof typeof T.triggers] ?? last.trigger}` : ''}
          </span>
        ) : null}
        {job.errors24h ? (
          <span className="text-destructive">{plural(locale, job.errors24h, T.errors24h)}</span>
        ) : null}
        {job.queued ? (
          <Badge variant="warning-light">
            {fill(T.queued, {
              status: t.ops.history.requestStatus[job.queued.status as 'pending'] ?? job.queued.status,
            })}
          </Badge>
        ) : null}
      </div>
      {last?.status === 'error' && job.lastOkAt ? (
        <span className="text-muted-foreground">
          {fill(T.lastOk, { when: f.relative(job.lastOkAt, at) })}
        </span>
      ) : null}
      {last?.error ? (
        <code className="text-destructive font-mono text-xs break-all">{last.error}</code>
      ) : null}
    </div>
  );
}

function RunNowButton({ job }: { job: JobStatus }) {
  const { t } = useI18n();
  const T = t.ops;
  const { pending, run } = useOpsAction();
  const label = T.jobs.names[job.name as keyof typeof T.jobs.names]?.label ?? job.name;
  if (!job.runNow) return null;
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="outline" size="sm" disabled={pending || Boolean(job.queued)} />}
      >
        {pending ? <Spinner /> : <Play />}
        {T.actions.runNow}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(T.actions.runNowTitle, { name: label })}</AlertDialogTitle>
          <AlertDialogDescription>
            {fill(T.actions.runNowBody, { service: T.services[job.service] })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(() => runJobNow(job.name), T.feedback.queued)}>
            {T.actions.runNow}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function JobsOverview({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  return (
    <CardShell icon={Activity} title={T.jobs.title}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{T.jobs.columns.job}</TableHead>
            <TableHead>{T.jobs.columns.schedule}</TableHead>
            <TableHead>{T.jobs.columns.last}</TableHead>
            <TableHead className="text-right">{T.jobs.columns.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.jobs.map((job) => {
            const cron = effective(snapshot, scheduleKey(job.name));
            return (
              <TableRow key={job.name}>
                <TableCell className="align-top">
                  <div className="flex flex-col">
                    <span className="text-sm">
                      {T.jobs.names[job.name as keyof typeof T.jobs.names]?.label ?? job.name}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {job.name} · {T.services[job.service]}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="align-top font-mono text-xs">
                  {cron === 'off' || !cron ? T.jobs.off : cron}
                </TableCell>
                <TableCell className="max-w-md align-top whitespace-normal">
                  <LastRun job={job} timeZone={timeZone} now={snapshot.generatedAt} />
                </TableCell>
                <TableCell className="text-right align-top">
                  <RunNowButton job={job} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardShell>
  );
}

function ScheduleTab({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const now = snapshot.generatedAt;
  const others = snapshot.settings.filter((s) => s.section === 'schedule' && !settingDef(s.key)!.job);
  // os jobs do registro, com a flag da agenda e o estado da última execução (a tabela agrupa e ordena)
  const rows: JobRow[] = SCHEDULED_JOBS.flatMap((j) => {
    const setting = snapshot.settings.find((s) => s.key === scheduleKey(j.name));
    const status = snapshot.jobs.find((x) => x.name === j.name);
    if (!setting || !status) return [];
    return [
      {
        job: j.name,
        key: setting.key,
        label: settingText(T, settingDef(setting.key)!).label,
        setting,
        status,
      },
    ];
  });
  const lastRun = useCallback(
    (job: JobStatus) => <LastRun job={job} timeZone={timeZone} now={now} />,
    [timeZone, now],
  );
  const runNow = useCallback((job: JobStatus) => <RunNowButton job={job} />, []);
  return (
    <JobsGrid
      rows={rows}
      timeZone={timeZone}
      now={now}
      lastRun={lastRun}
      runNow={runNow}
      footer={
        others.length ? (
          <FramePanel className="p-0">
            <div className="border-b px-4 py-3">
              <span className="text-sm font-semibold">{T.blocks.jobs.others}</span>
            </div>
            {others.map((s) => (
              <SettingRow key={`${s.key}:${s.source}:${s.value}`} setting={s} timeZone={timeZone} now={now} />
            ))}
          </FramePanel>
        ) : null
      }
    />
  );
}

// ── Histórico ─────────────────────────────────────────────────────────────────────────────────

function HistoryTab({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const show = (key: string, v: string | null) => {
    const def = settingDef(key);
    return def ? displayValue(T, def, v, { locale }) : (v ?? T.values.empty);
  };
  const label = (key: string) => {
    const def = settingDef(key);
    return def ? settingText(T, def).label : key;
  };
  // "Ver histórico" de uma linha chega com `?chave=`: só as mudanças daquela chave
  const only = useSearchParams().get('chave');
  const history = only ? snapshot.history.filter((h) => h.key === only) : snapshot.history;
  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.history.title}</FrameTitle>
            <FrameDescription>{T.history.description}</FrameDescription>
            {only ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span>{fill(T.history.filtered, { name: label(only) })}</span>
                <Link href="/ajustes/historico" className="text-primary text-sm hover:underline">
                  {T.history.showAll}
                </Link>
              </p>
            ) : null}
          </FrameHeader>
          {history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{T.history.when}</TableHead>
                  <TableHead>{T.history.who}</TableHead>
                  <TableHead>{T.history.what}</TableHead>
                  <TableHead>{T.history.change}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap">
                      {f.dateTime(h.changedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{h.changedBy}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{label(h.key)}</span>
                        <code className="text-muted-foreground font-mono text-xs">{h.key}</code>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      {h.action === 'reset'
                        ? fill(T.history.reset, { from: show(h.key, h.oldValue) })
                        : fill(T.history.set, {
                            from: h.oldValue === null ? T.history.base : show(h.key, h.oldValue),
                            to: show(h.key, h.newValue),
                          })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-4 text-sm">{T.history.empty}</p>
          )}
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.history.requests}</FrameTitle>
          </FrameHeader>
          {snapshot.requests.length ? (
            <Table>
              <TableBody>
                {snapshot.requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap">
                      {f.dateTime(r.requestedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{r.requestedBy}</TableCell>
                    <TableCell className="font-mono text-xs">{r.job}</TableCell>
                    <TableCell className="text-xs">
                      {T.history.requestStatus[r.status as keyof typeof T.history.requestStatus] ?? r.status}
                      {r.detail
                        ? ` · ${T.history.requestDetail[r.detail as keyof typeof T.history.requestDetail] ?? r.detail}`
                        : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-4 text-sm">{T.history.requestsEmpty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
