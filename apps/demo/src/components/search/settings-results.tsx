'use client';

import { FileText, SlidersHorizontal } from 'lucide-react';
import { useMemo } from 'react';

import { settingsNavGroups } from '@/components/admin/settings-nav';
import { Badge } from '@/components/reui/badge';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { useI18n } from '@/lib/i18n/client';
import {
  buildSettingsIndex,
  currentSettingsTabs,
  pageCrumbs,
  searchSettings,
  searchSettingsPages,
  settingsSearchPages,
  type SettingsSearchEntry,
  type SettingsSearchPage,
} from '@/lib/ops/settings-search';

/** Rota de Ajustes (o caminho do navegador vem sem o idioma). */
export const isSettingsPath = (pathname: string | null) =>
  !!pathname && (pathname === '/ajustes' || pathname.startsWith('/ajustes/'));

/**
 * Ajustes e páginas de Ajustes que casam com o termo, no idioma da tela. O índice é montado uma vez por idioma (só
 * com `enabled`: quem não é da equipe nem monta).
 */
export function useSettingsSearch(term: string, enabled: boolean, limits = { settings: 8, pages: 5 }) {
  const { t } = useI18n();
  const pages = useMemo(
    () => (enabled ? settingsSearchPages(settingsNavGroups(t.ops.nav), currentSettingsTabs(t)) : []),
    [enabled, t],
  );
  const index = useMemo(
    () => (enabled ? buildSettingsIndex({ t: t.ops, pages }) : []),
    [enabled, pages, t.ops],
  );
  const typed = term.trim();
  return {
    settings: typed ? searchSettings(index, typed, limits.settings) : [],
    pages: typed ? searchSettingsPages(pages, typed, limits.pages) : [],
  };
}

function SettingItem({ entry, onSelect }: { entry: SettingsSearchEntry; onSelect: (href: string) => void }) {
  const { t } = useI18n();
  return (
    <CommandItem
      value={`setting:${entry.key}`}
      onSelect={() => onSelect(entry.href)}
      className="gap-2.5 py-2"
    >
      <SlidersHorizontal className="text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{entry.label}</span>
          {entry.secret ? (
            <Badge variant="secondary" className="shrink-0">
              {t.ops.search.secret}
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground truncate text-xs">{entry.crumbs.join(' › ')}</span>
      </span>
      <code className="text-muted-foreground hidden shrink-0 font-mono text-xs sm:inline">{entry.key}</code>
    </CommandItem>
  );
}

function PageItem({ page, onSelect }: { page: SettingsSearchPage; onSelect: (href: string) => void }) {
  const { t } = useI18n();
  return (
    <CommandItem
      value={`settings-page:${page.id}`}
      onSelect={() => onSelect(page.href)}
      className="gap-2.5 py-2"
    >
      <FileText className="text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={page.soon ? 'text-muted-foreground truncate font-medium' : 'truncate font-medium'}>
          {page.label}
        </span>
        <span className="text-muted-foreground truncate text-xs">{pageCrumbs(page).join(' › ')}</span>
      </span>
      {page.soon ? (
        <Badge variant="secondary" className="shrink-0">
          {t.ops.search.soon}
        </Badge>
      ) : null}
    </CommandItem>
  );
}

/** Grupos "Ajustes" e "Páginas" da paleta (#1071). */
export function SettingsResultGroups({
  settings,
  pages,
  onSelect,
}: {
  settings: SettingsSearchEntry[];
  pages: SettingsSearchPage[];
  onSelect: (href: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {settings.length ? (
        <CommandGroup heading={t.ops.search.settings}>
          {settings.map((e) => (
            <SettingItem key={e.key} entry={e} onSelect={onSelect} />
          ))}
        </CommandGroup>
      ) : null}
      {pages.length ? (
        <CommandGroup heading={t.ops.search.pages}>
          {pages.map((p) => (
            <PageItem key={p.id} page={p} onSelect={onSelect} />
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}
