'use client';

import {
  GalaxieWidgetProvider,
  LiveList,
  MatchCard,
  StandingsTable,
  WIDGET_CATALOG,
  WhereToWatch,
  createPreviewFetch,
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
import {
  ENTITY_TYPES,
  NAME_MAX,
  PUBLISHABLE_KEY_ENV,
  WIDGET_KINDS,
  WIDGET_LOCALES,
  defaultsFromEntity,
  installCommand,
  usageSnippet,
  type WidgetLocale,
} from '@/lib/builder/config';
import type { WidgetKind, WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { fill } from '@/lib/i18n/text';

import { CodeSnippet } from './code-snippet';
import { EntityPicker, type EntityValue } from './entity-picker';
import { ThemeEditor } from './theme-editor';
import { KIND_ICONS, useKindTexts } from './widgets-panel';

export interface EditorDraft {
  name: string;
  kind: WidgetKind;
  theme: WidgetTheme;
  locale: WidgetLocale;
  market: string;
  entity: EntityValue | null;
}

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
}: {
  kind: WidgetKind;
  entity: EntityValue | null;
  market: string;
}) {
  if (!entity) {
    switch (kind) {
      case 'match_card':
        return <MatchCard {...WIDGET_CATALOG.match_card.exampleProps} />;
      case 'where_to_watch':
        return <WhereToWatch {...WIDGET_CATALOG.where_to_watch.exampleProps} />;
      case 'standings':
        return <StandingsTable {...WIDGET_CATALOG.standings.exampleProps} />;
      case 'live_list':
        return <LiveList />;
    }
  }
  switch (kind) {
    case 'match_card':
      return <MatchCard eventId={entity.id} />;
    case 'where_to_watch':
      return <WhereToWatch eventId={entity.id} market={market} />;
    case 'standings':
      return <StandingsTable competitionId={entity.id} season="current" />;
    case 'live_list':
      return <LiveList competitionId={entity.id} />;
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

  const kinds = WIDGET_KINDS.map((k) => ({ value: k, label: kindTexts(k).name }));
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
                    {fill(e.entityHint, {
                      types: entityTypes.map((x) => b.entityTypes[x]).join(', '),
                    })}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FramePanel>
          </Frame>
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
                  <PreviewWidget kind={draft.kind} entity={draft.entity} market={draft.market} />
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
