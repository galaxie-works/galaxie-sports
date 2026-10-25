'use client';

import type { SearchResponse } from '@galaxie/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CornerDownLeft,
  FileText,
  Hash,
  Languages,
  MapPin,
  Radio,
  SearchX,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Endpoint } from '@/components/docs/endpoint';
import { Crest } from '@/components/sport/crest';
import { Badge } from '@/components/reui/badge';
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth/client';
import type { DocGuideRef } from '@/lib/docs';
import { switchLocale, useI18n } from '@/lib/i18n/client';
import { apiLocale, LANGUAGES, type Locale } from '@/lib/i18n/config';
import type { ClientDictionary } from '@/lib/i18n/dictionary';
import { createFormatters } from '@/lib/i18n/format';
import { fill } from '@/lib/i18n/text';
import { sportBySlug } from '@/lib/navigation';
import {
  docsEntries,
  filterEntries,
  groupResults,
  type ApiOperationSummary,
  type SearchEntry,
} from '@/lib/search/entries';
import {
  addRecent,
  clearRecents,
  getRecents,
  getRecentsServer,
  subscribeRecents,
} from '@/lib/search/recents';
import { startTrailAt } from '@/lib/trail';

import { rememberLocale } from '../app-shell/user-menu';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Busca na API pelo proxy da demo. A cada termo novo, o React Query aborta a requisição anterior
 * (o `signal` vai para o fetch) e mantém os resultados antigos na tela até os novos chegarem.
 */
function useApiSearch(term: string, locale: Locale) {
  return useQuery({
    queryKey: ['busca-global', locale, term],
    enabled: term.length >= MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      // A API não fala inglês: a tela em inglês busca com nomes em es-AR (como o resto da demo).
      const qs = new URLSearchParams({ q: term, limit: '5', locale: apiLocale(locale) });
      const res = await fetch(`/api/galaxie/v1/search?${qs}`, { signal });
      if (!res.ok) throw new Error(`search ${res.status}`);
      return (await res.json()) as SearchResponse;
    },
  });
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  '/ao-vivo': Radio,
  '/ajustes/usuarios': Users,
  '/ajustes/sistema': SlidersHorizontal,
  '/docs': BookOpen,
};

type Texts = ClientDictionary['search'];

/** Prefixo das ações de idioma (não navegam: gravam o idioma e recarregam a página). */
const LANGUAGE_ACTION = 'idioma:';

function actionEntries(T: Texts, locale: Locale, isAdmin: boolean, docsDescription: string): SearchEntry[] {
  const action = (href: string, label: string, detail: string): SearchEntry => ({
    key: `action:${href}`,
    kind: 'action',
    href,
    label,
    detail,
    image: null,
    sport: null,
    topLevel: true,
  });
  return [
    action('/ao-vivo', T.live, T.liveDescription),
    action('/docs', T.docsHome, docsDescription),
    ...(isAdmin
      ? [
          action('/ajustes/usuarios', T.users, T.usersDescription),
          action('/ajustes/sistema', T.operations, T.operationsDescription),
        ]
      : []),
    ...LANGUAGES.filter((l) => l.value !== locale).map((l) => ({
      ...action(
        `${LANGUAGE_ACTION}${l.value}`,
        fill(T.language, { language: l.label }),
        T.languageDescription,
      ),
      topLevel: false,
    })),
  ];
}

function SportIcon({ slug }: { slug: string | null }) {
  const { t } = useI18n();
  const sport = slug ? sportBySlug(slug) : undefined;
  if (!sport) return null;
  const Icon = sport.icon;
  const label = t.nav.sports[sport.slug];
  return (
    <span title={label} className="text-muted-foreground flex shrink-0 items-center">
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const DOC_ICON: Partial<Record<SearchEntry['kind'], LucideIcon>> = { section: Hash, doc: FileText };

/** Escudo, foto, bandeira ou ícone à esquerda do item. */
function EntryMedia({ entry }: { entry: SearchEntry }) {
  if (entry.event) {
    return (
      <span className="flex shrink-0 -space-x-1.5">
        {entry.event.crests.slice(0, 2).map((c, i) => (
          <Crest key={`${c.name}-${i}`} src={c.logo} name={c.name} size="xs" />
        ))}
      </span>
    );
  }
  switch (entry.kind) {
    case 'person':
      return <Crest src={entry.image} name={entry.label} size="xs" round />;
    case 'venue':
      return entry.image ? (
        <img src={entry.image} alt="" className="size-5 shrink-0 rounded object-cover" draggable={false} />
      ) : (
        <MapPin className="text-muted-foreground" aria-hidden />
      );
    case 'country':
      return entry.image ? (
        <img
          src={entry.image}
          alt=""
          className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-white/10"
          draggable={false}
        />
      ) : (
        <Crest src={null} name={entry.label} size="xs" />
      );
    case 'team':
    case 'competition':
      return <Crest src={entry.image} name={entry.label} size="xs" />;
    case 'action': {
      const Icon = entry.href.startsWith(LANGUAGE_ACTION)
        ? Languages
        : (ACTION_ICONS[entry.href] ?? FileText);
      return <Icon className="text-muted-foreground" aria-hidden />;
    }
    case 'endpoint':
      return null;
    default: {
      const Icon = DOC_ICON[entry.kind] ?? FileText;
      return <Icon className="text-muted-foreground" aria-hidden />;
    }
  }
}

/** Data do jogo no idioma da tela e no fuso do navegador (a paleta só desenha no navegador). */
function useEventDate() {
  const { locale } = useI18n();
  return useMemo(() => createFormatters(locale, Intl.DateTimeFormat().resolvedOptions().timeZone), [locale]);
}

function EntryItem({ entry, onSelect }: { entry: SearchEntry; onSelect: (e: SearchEntry) => void }) {
  const { t } = useI18n();
  const T = t.search;
  const f = useEventDate();
  // provisório: só a data (o horário pode ainda não ter sido anunciado)
  const startsAt =
    entry.event && !entry.event.live
      ? entry.event.provisional
        ? `${f.date(entry.event.startsAt)} · ${t.sport.provisional.badge}`
        : f.dateTime(entry.event.startsAt)
      : null;
  return (
    <CommandItem value={entry.key} onSelect={() => onSelect(entry)} className="gap-2.5 py-2">
      <EntryMedia entry={entry} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {entry.kind === 'endpoint' && entry.method ? (
            <Endpoint method={entry.method} route={entry.label} />
          ) : (
            <span className="truncate font-medium">{entry.label}</span>
          )}
          {/* No jogo o apelido repetiria o do time: fica só no time. */}
          {entry.matched && !entry.event ? (
            <span className="text-muted-foreground shrink-0 truncate text-xs">
              {fill(T.matchedBy, { alias: entry.matched })}
            </span>
          ) : null}
        </span>
        {entry.detail || startsAt ? (
          <span className="text-muted-foreground truncate text-xs">
            {/* No celular a data do jogo vai para a segunda linha (o nome dos times precisa do espaço). */}
            {startsAt ? <span className="tabular-nums sm:hidden">{startsAt} · </span> : null}
            {entry.detail}
          </span>
        ) : null}
      </span>
      {entry.event ? (
        entry.event.live ? (
          <Badge variant="destructive-light" size="sm" className="shrink-0">
            <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
            {T.live}
          </Badge>
        ) : (
          <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
            {startsAt}
          </span>
        )
      ) : null}
      <SportIcon slug={entry.sport} />
    </CommandItem>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

/**
 * Paleta de busca (⌘K) sobre o command do shadcn/ReUI (`@reui/c-command-1`): resultados reais da
 * API (times, competições, jogos, pessoas, estádios e países), a documentação e atalhos. Sem filtro
 * do cmdk: a API já devolve o que casou (inclusive por apelido) e o resto é filtrado aqui.
 */
export function CommandPalette({
  open,
  onOpenChange,
  guides,
  operations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guides: DocGuideRef[];
  operations: ApiOperationSummary[];
}) {
  const { locale, t } = useI18n();
  const T = t.search;
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === 'admin';
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim(), DEBOUNCE_MS);
  const search = useApiSearch(term, locale);
  const recents = useSyncExternalStore(subscribeRecents, getRecents, getRecentsServer);

  const docs = useMemo(() => docsEntries(guides, operations), [guides, operations]);
  const typed = query.trim();
  const apiActive = term.length >= MIN_CHARS;
  const groups = apiActive && search.data ? groupResults(search.data.data) : [];
  const docHits = typed ? filterEntries(docs, typed, 6) : docs.filter((d) => d.kind === 'doc');
  const actions = filterEntries(actionEntries(T, locale, isAdmin, guides[0]?.description ?? ''), typed);
  const waiting = typed.length >= MIN_CHARS && (term !== typed || search.isFetching);
  const nothing = !!typed && !groups.length && !docHits.length && !actions.length;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery('');
  }

  function go(entry: SearchEntry) {
    if (entry.href.startsWith(LANGUAGE_ACTION)) {
      const next = entry.href.slice(LANGUAGE_ACTION.length) as Locale;
      // Como o seletor do menu do usuário: guarda no perfil, limpa a trilha e recarrega no novo idioma.
      void rememberLocale(next).finally(() => switchLocale(next));
      return;
    }
    // Recentes sem o estado do jogo (ao vivo muda) nem o apelido que casou (era desta busca).
    addRecent({ ...entry, key: entry.key.replace(/^recent:/, ''), event: undefined, matched: null });
    if (entry.topLevel) startTrailAt(entry.href.split('#')[0] ?? entry.href);
    close(false);
    router.push(entry.href);
  }

  const actionsGroup = actions.length ? (
    <>
      <CommandSeparator />
      <CommandGroup heading={T.actions}>
        {actions.map((e) => (
          <EntryItem key={e.key} entry={e} onSelect={go} />
        ))}
      </CommandGroup>
    </>
  ) : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title={T.dialogTitle}
      description={T.dialogDescription}
      className="top-[12vh] sm:max-w-2xl"
    >
      <Command shouldFilter={false} loop className="**:data-[selected=true]:bg-muted">
        <div className="relative">
          <CommandInput value={query} onValueChange={setQuery} placeholder={T.placeholder} className="pr-8" />
          {waiting ? (
            <span
              className="text-muted-foreground absolute top-1/2 right-4 -translate-y-1/2"
              aria-live="polite"
            >
              <Spinner className="size-3.5" aria-label={T.loading} />
            </span>
          ) : null}
        </div>
        <CommandList className="max-h-[min(60vh,32rem)]">
          {nothing && !waiting ? (
            <CommandEmpty className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <SearchX className="text-muted-foreground size-6" aria-hidden />
              <span className="font-medium">{fill(T.emptyTitle, { query: typed })}</span>
              <span className="text-muted-foreground max-w-sm text-xs">
                {typed.length < MIN_CHARS ? T.minChars : T.emptyHint}
              </span>
            </CommandEmpty>
          ) : null}

          {!typed && recents.length ? (
            <CommandGroup
              heading={
                <span className="flex items-center justify-between">
                  {T.recent}
                  <button
                    type="button"
                    onClick={clearRecents}
                    className="hover:text-foreground inline-flex items-center gap-1 font-normal"
                  >
                    <X className="size-3" aria-hidden /> {T.clearRecent}
                  </button>
                </span>
              }
            >
              {recents.map((e) => (
                <EntryItem key={`recent-${e.key}`} entry={{ ...e, key: `recent:${e.key}` }} onSelect={go} />
              ))}
            </CommandGroup>
          ) : null}

          {search.isError && apiActive ? (
            <p className="text-muted-foreground px-3 py-2 text-xs">{T.error}</p>
          ) : null}

          {groups.map(([type, entries]) => (
            <CommandGroup key={type} heading={T.groups[type]}>
              {entries.map((e) => (
                <EntryItem key={e.key} entry={e} onSelect={go} />
              ))}
            </CommandGroup>
          ))}

          {/* Sem termo, os atalhos vêm antes das páginas da documentação; com termo, depois. */}
          {!typed ? actionsGroup : null}

          {docHits.length ? (
            <CommandGroup heading={T.docs}>
              {docHits.map((e) => (
                <EntryItem key={e.key} entry={e} onSelect={go} />
              ))}
            </CommandGroup>
          ) : null}

          {typed ? actionsGroup : null}
        </CommandList>
        <div className="text-muted-foreground hidden items-center gap-4 border-t px-3 py-2 text-[11px] sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {T.hints.navigate}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-3" aria-hidden />
            </Kbd>{' '}
            {T.hints.open}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>{T.hints.escKey}</Kbd> {T.hints.close}
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
