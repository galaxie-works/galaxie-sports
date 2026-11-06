'use client';

import {
  AiContext,
  GalaxieWidgetProvider,
  HeadToHead,
  LiveList,
  MatchCard,
  MatchStakes,
  RelatedVideos,
  StandingsTable,
  TeamSchedule,
  WIDGET_CATALOG,
  WhereToWatch,
  createPreviewFetch,
  optionProps,
  parseLiveListOptions,
  parseStandingsOptions,
  parseWidgetOptions,
  type LiveListOptions,
  type StandingsOptions,
  type WidgetOptions,
} from '@galaxie/widgets';
import { ArrowLeft, Info, Save, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveWidgetAction } from '@/app/[locale]/(app)/cliente/actions';
import { LanguageOption } from '@/components/app-shell/language-select';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ENTITY_TYPES,
  NAME_MAX,
  PUBLISHABLE_KEY_ENV,
  REQUIRED_ENTITY,
  OFFERED_WIDGET_KINDS,
  WIDGET_KINDS,
  WIDGET_LOCALES,
  defaultsFromEntity,
  embedSnippet,
  installCommand,
  usageSnippet,
  type WidgetLocale,
} from '@/lib/builder/config';
import type { WidgetKind, WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { fill, rich } from '@/lib/i18n/text';

import { CodeSnippet } from './code-snippet';
import { EntityPicker, type EntityValue } from './entity-picker';
import { LiveListOptionsEditor } from './live-list-options-editor';
import { StandingsZonesEditor } from './standings-zones-editor';
import { ThemeEditor } from './theme-editor';
import { WidgetOptionsEditor, hasWidgetOptions, type OptionEntities } from './widget-options-editor';
import { KIND_ICONS, useKindTexts } from './widgets-panel';

export interface EditorDraft {
  name: string;
  kind: WidgetKind;
  theme: WidgetTheme;
  locale: WidgetLocale;
  market: string;
  entity: EntityValue | null;
  /** Legenda e cores das zonas (só vale na tabela de classificação). */
  standings: StandingsOptions;
  /** Modo, agrupamento, atualização e dados extras (só vale na lista de jogos). */
  liveList: LiveListOptions;
  /** Opções de conteúdo do tipo (`WIDGET_OPTIONS`): campos liga/desliga, quantidades, filtros. */
  options: WidgetOptions;
  /** Nome e escudo das entidades escolhidas nas opções (só para exibir; o banco guarda o id). */
  optionEntities: OptionEntities;
}

/** Opções da lista de jogos que vão para o banco (nenhuma nos outros tipos). */
const liveListOf = (d: EditorDraft) =>
  d.kind === 'live_list' ? parseLiveListOptions(d.liveList) : undefined;

/** Opções de conteúdo que vão para o banco (só as do tipo, válidas e diferentes do padrão). */
const optionsOf = (d: EditorDraft) => parseWidgetOptions(d.kind, d.options);

/** Opções da tabela que vão para o banco (nenhuma nos outros tipos). */
const standingsOf = (d: EditorDraft) =>
  d.kind === 'standings' ? parseStandingsOptions(d.standings) : undefined;

export interface SavedInfo {
  id: string;
  version: number;
}

/** O que vai para o banco (a comparação com a última gravação ignora o rótulo e a imagem da entidade). */
const snapshot = (d: EditorDraft) =>
  JSON.stringify({
    name: d.name.trim(),
    kind: d.kind,
    theme: d.theme,
    locale: d.locale,
    market: d.market,
    defaults: defaultsFromEntity(d.entity),
    standings: standingsOf(d),
    liveList: liveListOf(d),
    options: optionsOf(d),
  });

/**
 * Pré-visualização com dados reais: o `fetch` vai ao proxy da demo (`/api/galaxie/v1/...`), que injeta a
 * chave interna no servidor. Nenhuma chave vai ao navegador (o header da chave publicável segue vazio e o
 * proxy não o repassa).
 */
const proxyFetch: typeof fetch = (input, init) => fetch(input, init);

/** Idioma do widget → idioma da demo (só para o rótulo com a bandeira). */
const screenLocale = (l: WidgetLocale): Locale => (l === 'es' ? 'es-AR' : l);

/**
 * O componente do tipo de widget. Com a entidade padrão, os dados reais dela; sem ela, os dados de exemplo
 * do pacote (`exampleProps`), menos na lista de jogos, que funciona sem recorte.
 */
function PreviewWidget({
  kind,
  entity,
  market,
  standings,
  liveList,
  options,
}: {
  kind: WidgetKind;
  entity: EntityValue | null;
  market: string;
  standings: StandingsOptions;
  liveList: LiveListOptions;
  options: WidgetOptions;
}) {
  const zones = { showLegend: standings.showLegend, zoneColors: standings.zoneColors };
  const o = optionProps(kind, options);
  if (!entity) {
    switch (kind) {
      case 'match_card':
        return <MatchCard {...o} {...WIDGET_CATALOG.match_card.exampleProps} />;
      case 'where_to_watch':
        return <WhereToWatch {...o} {...WIDGET_CATALOG.where_to_watch.exampleProps} />;
      case 'standings':
        return <StandingsTable {...WIDGET_CATALOG.standings.exampleProps} {...o} {...zones} />;
      case 'live_list':
        return <LiveList {...liveList} />;
      case 'ai_context':
        return <AiContext {...o} {...WIDGET_CATALOG.ai_context.exampleProps} />;
      case 'match_stakes':
        return <MatchStakes {...o} {...WIDGET_CATALOG.match_stakes.exampleProps} />;
      case 'related_videos':
        return <RelatedVideos {...o} {...WIDGET_CATALOG.related_videos.exampleProps} />;
      case 'head_to_head':
        return <HeadToHead {...o} {...WIDGET_CATALOG.head_to_head.exampleProps} />;
      case 'team_schedule':
        return <TeamSchedule {...o} {...WIDGET_CATALOG.team_schedule.exampleProps} />;
    }
  }
  switch (kind) {
    case 'match_card':
      return <MatchCard {...o} eventId={entity.id} />;
    case 'where_to_watch':
      return <WhereToWatch {...o} eventId={entity.id} market={market} />;
    case 'standings':
      return <StandingsTable season="current" {...o} competitionId={entity.id} {...zones} />;
    case 'live_list':
      return <LiveList {...liveList} competitionId={entity.id} />;
    case 'ai_context':
      return <AiContext {...o} eventId={entity.id} />;
    case 'match_stakes':
      return <MatchStakes {...o} eventId={entity.id} />;
    case 'related_videos':
      return <RelatedVideos {...o} eventId={entity.id} />;
    case 'head_to_head':
      return <HeadToHead {...o} eventId={entity.id} />;
    case 'team_schedule':
      return <TeamSchedule {...o} teamId={entity.id} />;
  }
}

/**
 * Builder de um widget: identidade, tema e conteúdo à esquerda; à direita, a pré-visualização ao vivo
 * (dados reais pelo proxy `/api/galaxie`, que injeta a chave interna da demo no servidor) e a instalação
 * (comando do shadcn, uso no código e a variável da chave publicável), que aparece depois de salvar.
 */
export function WidgetEditor({
  initial,
  saved: savedInitial,
  markets,
}: {
  initial: EditorDraft;
  saved: SavedInfo | null;
  /** Mercados que o plano permite. */
  markets: string[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const e = t.client.editor;
  const b = t.client.builder;
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(savedInitial);
  const [savedSnapshot, setSavedSnapshot] = useState(savedInitial ? snapshot(initial) : null);
  const [pending, startTransition] = useTransition();
  const kindTexts = useKindTexts();
  const sampleFetch = useMemo(() => createPreviewFetch(), []);
  const entityTypes = ENTITY_TYPES[draft.kind];
  const dirty = savedSnapshot !== snapshot(draft);
  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const kinds = WIDGET_KINDS.filter(
    (k) => k === draft.kind || (OFFERED_WIDGET_KINDS as readonly string[]).includes(k),
  ).map((k) => ({
    value: k,
    label: kindTexts(k).name,
  }));
  const marketItems = markets.map((m) => ({
    value: m,
    label: t.nav.countries[m as keyof typeof t.nav.countries] ?? m,
  }));
  const localeItems = WIDGET_LOCALES.map((l) => ({ value: l, label: l }));
  const config = {
    theme: draft.theme,
    locale: draft.locale,
    market: draft.market,
    defaults: defaultsFromEntity(draft.entity),
    ...(standingsOf(draft) ? { standings: standingsOf(draft) } : {}),
    ...(liveListOf(draft) ? { liveList: liveListOf(draft) } : {}),
    ...(optionsOf(draft) ? { options: optionsOf(draft) } : {}),
  };
  const usage = usageSnippet({ kind: draft.kind, name: draft.name.trim() || kindTexts(draft.kind).name });
  // lista de jogos funciona sem recorte; os outros tipos, sem entidade, mostram os dados de exemplo
  const realData = Boolean(draft.entity) || draft.kind === 'live_list';

  function save() {
    startTransition(async () => {
      const res = await saveWidgetAction({
        id: saved?.id ?? null,
        kind: draft.kind,
        name: draft.name,
        config,
      });
      if (!res.ok || !res.widget) return void toast.error(res.error ?? t.client.errors.generic);
      toast.success(fill(e.saved, { n: res.widget.version }));
      setSaved({ id: res.widget.id, version: res.widget.version });
      setSavedSnapshot(snapshot(draft));
      if (!saved) router.replace(`/cliente/builder/${res.widget.id}`);
      else router.refresh();
    });
  }

  const KindIcon = KIND_ICONS[draft.kind];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/cliente/builder" />}>
          <ArrowLeft />
          {e.back}
        </Button>
        <div className="flex items-center gap-2">
          {saved ? (
            <Badge variant="outline">{fill(e.version, { n: saved.version })}</Badge>
          ) : (
            <Badge variant="secondary">{e.unsaved}</Badge>
          )}
          {saved && dirty ? <Badge variant="warning-light">{e.dirty}</Badge> : null}
          <Button onClick={save} disabled={pending || !draft.name.trim() || (!!saved && !dirty)}>
            {pending ? <Spinner /> : <Save />}
            {saved ? e.save : e.saveNew}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Frame>
            <FramePanel className="flex flex-col gap-4">
              <FrameTitle>{e.identity}</FrameTitle>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="widget-name">{e.name}</FieldLabel>
                  <Input
                    id="widget-name"
                    maxLength={NAME_MAX}
                    placeholder={e.namePlaceholder}
                    value={draft.name}
                    onChange={(ev) => set('name', ev.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="widget-kind">{e.kind}</FieldLabel>
                  <Select
                    items={kinds}
                    value={draft.kind}
                    onValueChange={(v) => {
                      const kind = v as WidgetKind;
                      const types = ENTITY_TYPES[kind];
                      setDraft((d) => ({
                        ...d,
                        kind,
                        // a entidade escolhida só fica se o novo tipo aceitar
                        entity: d.entity && types.includes(d.entity.type) ? d.entity : null,
                        // as opções são de cada tipo: as que o novo tipo não conhece saem
                        options: parseWidgetOptions(kind, d.options) ?? {},
                      }));
                    }}
                  >
                    <SelectTrigger id="widget-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {kinds.map((k) => {
                        const Icon = KIND_ICONS[k.value];
                        return (
                          <SelectItem key={k.value} value={k.value}>
                            <Icon className="text-muted-foreground" aria-hidden />
                            {k.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{kindTexts(draft.kind).description}</FieldDescription>
                </Field>
              </FieldGroup>
            </FramePanel>
          </Frame>

          <Frame>
            <FramePanel className="flex flex-col gap-4">
              <FrameTitle>{e.theme}</FrameTitle>
              <ThemeEditor value={draft.theme} onChange={(theme) => set('theme', theme)} />
            </FramePanel>
          </Frame>

          <Frame>
            <FramePanel className="flex flex-col gap-4">
              <FrameTitle>{e.content}</FrameTitle>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="widget-locale">{e.locale}</FieldLabel>
                  <Select
                    items={localeItems}
                    value={draft.locale}
                    onValueChange={(v) => v && set('locale', v as WidgetLocale)}
                  >
                    <SelectTrigger id="widget-locale" className="w-full">
                      <SelectValue>
                        {(v: WidgetLocale) => <LanguageOption value={screenLocale(v)} />}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WIDGET_LOCALES.map((l) => (
                        <SelectItem key={l} value={l}>
                          <LanguageOption value={screenLocale(l)} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="widget-market">{e.market}</FieldLabel>
                  <Select
                    items={marketItems}
                    value={draft.market}
                    onValueChange={(v) => v && set('market', String(v))}
                  >
                    <SelectTrigger id="widget-market" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {marketItems.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{e.marketHint}</FieldDescription>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>{e.entity}</FieldLabel>
                  <EntityPicker types={entityTypes} value={draft.entity} onChange={(v) => set('entity', v)} />
                  <FieldDescription>
                    {fill(REQUIRED_ENTITY[draft.kind] ? e.entityHintRequired : e.entityHint, {
                      types: entityTypes.map((x) => b.entityTypes[x]).join(', '),
                    })}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FramePanel>
          </Frame>

          {hasWidgetOptions(draft.kind) ? (
            <Frame>
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>{e.options.title}</FrameTitle>
                  <FrameDescription>{e.options.description}</FrameDescription>
                </FrameHeader>
                <WidgetOptionsEditor
                  kind={draft.kind}
                  value={draft.options}
                  entities={draft.optionEntities}
                  onChange={(options, optionEntities) => setDraft((d) => ({ ...d, options, optionEntities }))}
                />
              </FramePanel>
            </Frame>
          ) : null}

          {draft.kind === 'standings' ? (
            <Frame>
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>{e.zones.title}</FrameTitle>
                  <FrameDescription>{e.zones.description}</FrameDescription>
                </FrameHeader>
                <StandingsZonesEditor
                  value={draft.standings}
                  primary={draft.theme.primary}
                  onChange={(standings) => set('standings', standings)}
                />
              </FramePanel>
            </Frame>
          ) : null}

          {draft.kind === 'live_list' ? (
            <Frame>
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>{e.liveList.title}</FrameTitle>
                  <FrameDescription>{e.liveList.description}</FrameDescription>
                </FrameHeader>
                <LiveListOptionsEditor
                  value={draft.liveList}
                  onChange={(liveList) => set('liveList', liveList)}
                />
              </FramePanel>
            </Frame>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-18 lg:self-start">
          <Frame>
            <FramePanel className="flex flex-col gap-3">
              <FrameHeader className="p-0">
                <FrameTitle className="flex items-center gap-2">
                  <KindIcon className="text-muted-foreground size-4" aria-hidden />
                  {e.preview}
                </FrameTitle>
                <FrameDescription>{realData ? e.previewNote : e.previewSample}</FrameDescription>
              </FrameHeader>
              <div
                className="rounded-lg border p-4 transition-colors"
                style={{ background: draft.theme.background, borderColor: draft.theme.border }}
              >
                <GalaxieWidgetProvider
                  key={realData ? 'real' : 'exemplo'}
                  baseUrl="/api/galaxie"
                  publishableKey=""
                  fetch={realData ? proxyFetch : sampleFetch}
                  theme={draft.theme}
                  locale={draft.locale}
                  market={draft.market}
                >
                  <PreviewWidget
                    kind={draft.kind}
                    entity={draft.entity}
                    market={draft.market}
                    standings={draft.standings}
                    liveList={draft.liveList}
                    options={draft.options}
                  />
                </GalaxieWidgetProvider>
              </div>
            </FramePanel>
          </Frame>

          <Frame>
            <FramePanel className="flex flex-col gap-3">
              <FrameHeader className="p-0">
                <FrameTitle>{e.install.title}</FrameTitle>
                <FrameDescription>{e.install.description}</FrameDescription>
              </FrameHeader>
              {saved ? (
                <>
                  {dirty ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>{e.install.dirty}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Tabs defaultValue="html">
                    <TabsList>
                      <TabsTrigger value="html">{e.install.tabHtml}</TabsTrigger>
                      <TabsTrigger value="react">{e.install.tabReact}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="html" className="flex flex-col gap-3 pt-1">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.embed}</span>
                        <span className="text-muted-foreground text-xs">{e.install.embedHint}</span>
                        <CodeSnippet code={embedSnippet(saved.id)} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.embedKey}</span>
                        <span className="text-muted-foreground text-xs">
                          {rich(e.install.embedKeyHint, {
                            k: (chunk) => (
                              <Link
                                href="/cliente/chaves"
                                className="text-foreground underline underline-offset-2"
                              >
                                {chunk}
                              </Link>
                            ),
                          })}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.embedOptions}</span>
                        <span className="text-muted-foreground text-xs">{e.install.embedOptionsHint}</span>
                      </div>
                      <Alert>
                        <Info />
                        <AlertDescription>{e.install.embedLive}</AlertDescription>
                      </Alert>
                    </TabsContent>
                    <TabsContent value="react" className="flex flex-col gap-3 pt-1">
                      <span className="text-muted-foreground text-xs">{e.install.reactDescription}</span>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.command}</span>
                        <CodeSnippet code={installCommand(saved.id)} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.usage}</span>
                        <CodeSnippet code={usage} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">{e.install.env}</span>
                        <span className="text-muted-foreground text-xs">{e.install.envHint}</span>
                        <CodeSnippet code={`${PUBLISHABLE_KEY_ENV}=gs_pk_live_…`} />
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              ) : (
                <Alert>
                  <Info />
                  <AlertDescription>{e.install.saveFirst}</AlertDescription>
                </Alert>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </div>
  );
}
