'use client';

import {
  Activity,
  Archive,
  AtSign,
  BadgeCheck,
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  Clapperboard,
  DatabaseBackup,
  FileText,
  Flag,
  Gauge,
  Globe,
  History,
  House,
  KeyRound,
  Languages,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  MonitorPlay,
  MonitorSmartphone,
  Radio,
  Scale,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShoppingBag,
  SquarePlay,
  Tags,
  Timer,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  Webhook,
} from 'lucide-react';
import { createContext, Suspense, use, useContext, type ReactNode } from 'react';

import { CosmosIcon } from '@/components/cosmos/cosmos-icon';
import { Badge } from '@/components/reui/badge';
import { useSearch, useShortcutLabel } from '@/components/search/search-provider';
import {
  GroupedNavSheet,
  type NavGroup,
  type NavIcon,
  type NavLeaf,
} from '@/components/settings/grouped-nav';
import {
  OnThisPage,
  showOnThisPage,
  type OnThisPageSection,
} from '@/components/settings/page-chrome/on-this-page';
import {
  PageChangedFilter,
  PageChromeProvider,
  usePageChromeReport,
} from '@/components/settings/page-chrome/page-state';
import { SettingAnchor } from '@/components/settings/page-chrome/setting-anchor';
import { SettingsPageHeader } from '@/components/settings/page-chrome/settings-page-header';
import { Button } from '@/components/ui/button';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import {
  SETTINGS_HOME,
  SETTINGS_ITEMS,
  SETTINGS_NAV_GROUPS,
  type SettingsItemId,
  type SettingsNavGroupId,
  type SettingsNavId,
} from '@/lib/ops/settings-items';

export { SETTINGS_ITEMS as SETTINGS_NAV, SETTINGS_NAV_GROUPS, type SettingsNavGroupId };
/** Área ativa de uma página de Ajustes (um dos 43 itens ou o Início). */
export type SettingsSectionId = SettingsNavId;

/** Ícone de cada item do menu de Ajustes. */
export const SETTINGS_ICONS: Record<SettingsNavId, NavIcon> = {
  home: House,
  tvApps: MonitorSmartphone,
  site: Globe,
  messaging: MessageCircle,
  subscriptions: Wallet,
  signups: UserPlus,
  domains: AtSign,
  organizations: Building2,
  users: Users,
  webhooks: Webhook,
  catalog: Boxes,
  metering: Gauge,
  plans: Tags,
  advertising: Megaphone,
  countryProfile: Flag,
  legalHold: Archive,
  moderation: ShieldAlert,
  secondAppeal: Scale,
  terms: FileText,
  crests: Shield,
  mirror: DatabaseBackup,
  provider: Server,
  quality: BadgeCheck,
  review: ListChecks,
  liveChat: MessagesSquare,
  communities: UsersRound,
  gamification: Trophy,
  shopping: ShoppingBag,
  cosmos: CosmosIcon,
  ai: Bot,
  schedule: CalendarClock,
  credentials: KeyRound,
  emails: Mail,
  history: History,
  languages: Languages,
  status: Activity,
  suggestions: MessageSquareText,
  tasks: ListTodo,
  live: Radio,
  lineup: MonitorPlay,
  wtw: Clapperboard,
  postgame: Timer,
  related: SquarePlay,
  widgets: LayoutGrid,
};

/**
 * Contagens do que espera ação, no padrão c-sidebar-1 (#1068): Revisão do catálogo (fila da revisão), Grades e ofertas
 * (pedidos das operadoras em aberto) e Início (a soma). Lidas no servidor dos mesmos dados das páginas; null = não deu
 * para ler.
 */
export interface SettingsNavCounts {
  home: number | null;
  review: number | null;
  lineup: number | null;
}
const COUNTED = ['home', 'review', 'lineup'] as const;

/** A promessa das contagens (o layout de Ajustes não espera por ela: o selo chega por streaming). */
const CountsContext = createContext<Promise<SettingsNavCounts> | null>(null);
export const SettingsCountsProvider = CountsContext.Provider;
/** A promessa das contagens do menu (para quem a lê com `use`, dentro de um Suspense). */
export const useSettingsCounts = () => useContext(CountsContext);

function CountValue({ id }: { id: (typeof COUNTED)[number] }) {
  const { t } = useI18n();
  const counts = useContext(CountsContext);
  const n = counts ? use(counts)[id] : null;
  if (!n) return null;
  return (
    <Badge variant="warning-light" size="sm" radius="full" className="tabular-nums">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{fill(t.ops.nav.pending, { n: String(n) })}</span>
    </Badge>
  );
}

function CountBadge({ id }: { id: (typeof COUNTED)[number] }) {
  return (
    <Suspense fallback={null}>
      <CountValue id={id} />
    </Suspense>
  );
}

type NavTexts = Dictionary['ops']['nav'];

function leafOf(nav: NavTexts, id: SettingsNavId, href: string, soon: boolean): NavLeaf {
  const counted = (COUNTED as readonly string[]).includes(id);
  return {
    id,
    href,
    icon: SETTINGS_ICONS[id],
    label: nav[id],
    ...(soon
      ? {
          muted: true,
          badge: (
            <Badge variant="secondary" size="sm">
              {nav.soon}
            </Badge>
          ),
        }
      : counted
        ? { badge: <CountBadge id={id as (typeof COUNTED)[number]} /> }
        : {}),
  };
}

/** Início, fixo no topo (A2), fora dos grupos e da ordem alfabética. */
export function settingsNavPinned(nav: NavTexts): NavLeaf[] {
  return [leafOf(nav, SETTINGS_HOME.id, SETTINGS_HOME.href, false)];
}

/** Os 9 grupos com os itens no idioma da tela, grupos e itens em ordem alfabética (`sortByLabel`). */
export function settingsNavGroups(nav: NavTexts): NavGroup[] {
  return sortByLabel(
    SETTINGS_NAV_GROUPS.map((group) => ({
      id: group,
      label: nav.groups[group],
      items: sortByLabel(
        SETTINGS_ITEMS.filter((i) => i.group === group).map((i) => leafOf(nav, i.id, i.href, 'soon' in i)),
      ),
    })),
  ).filter((g) => g.items.length > 0);
}

/** Grupo de um item (para o caminho Ajustes / Grupo / Item). */
export const settingsGroupOf = (id: SettingsItemId): SettingsNavGroupId =>
  SETTINGS_ITEMS.find((i) => i.id === id)!.group;

/** Onde fica lembrado o que a pessoa abriu ou fechou no menu de Ajustes (A6). */
export const SETTINGS_MENU_STORAGE = 'galaxie:ajustes:grupos';

/**
 * Campo "Buscar ajuste…" no topo da coluna e da gaveta de Ajustes (#1067): abre a paleta ⌘K já na busca de ajustes
 * (#1071), com os ajustes e as páginas de Ajustes na frente.
 */
export function SettingsSearchField({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const { openSettings } = useSearch();
  const shortcut = useShortcutLabel();
  return (
    <Button
      variant="outline"
      className="text-muted-foreground hover:text-foreground w-full justify-start gap-2 font-normal"
      onClick={() => {
        onOpen?.();
        openSettings();
      }}
    >
      <Search aria-hidden="true" />
      <span className="flex-1 truncate text-left">{t.ops.nav.search}</span>
      {shortcut ? (
        <kbd className="bg-muted text-muted-foreground rounded border px-1.5 font-mono text-xs">
          {shortcut}
        </kbd>
      ) : null}
    </Button>
  );
}

/**
 * Moldura de uma página de Ajustes (`app-shell-14`, #1067) com o topo comum (#1072): o cabeçalho (caminho Ajustes ›
 * Grupo › Item, título, a frase do que a página controla, "Atualizado" e "Atualizar" quando o conteúdo conta quando
 * leu os dados, e os links do job e do histórico), a barra de abas da página (`tabs`) com o filtro "Alterados no
 * painel" à direita, o conteúdo e, à direita dele em telas ≥ xl, o índice "Nesta página" (`sections`, com 2+ seções).
 * Chegada por `#CHAVE` (a busca de ajustes, #1071) rola até a linha e a destaca. O menu fica na segunda coluna (layout
 * de Ajustes); no celular ele vai para a gaveta, aberta pelo botão com a página atual.
 */
export function SettingsArea({
  active,
  title,
  description,
  job,
  historyHref,
  tabs,
  sections,
  bare,
  children,
}: {
  active: SettingsSectionId;
  /** Título da página; o padrão é o nome do item no menu. */
  title?: string;
  /** Uma frase do que a página controla. */
  description?: ReactNode;
  /** Job que aplica os ajustes da página e o link dele na Agenda. */
  job?: { name: string; href: string };
  /** Histórico e auditoria. */
  historyHref?: string;
  /** Abas da página (ex.: Grades e ofertas: Revisão, Pedidos das operadoras…). */
  tabs?: ReactNode;
  /** Seções da página para o "Nesta página" (`id` do elemento e rótulo). */
  sections?: readonly OnThisPageSection[];
  /** Só o caminho, sem título nem frase: a página tem o próprio topo (a de "Em breve"). */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <PageChromeProvider>
      <SettingsAreaBody
        bare={bare}
        active={active}
        title={title}
        description={description}
        job={job}
        historyHref={historyHref}
        tabs={tabs}
        sections={sections}
      >
        {children}
      </SettingsAreaBody>
    </PageChromeProvider>
  );
}

function SettingsAreaBody({
  active,
  title,
  description,
  job,
  historyHref,
  tabs,
  sections,
  bare,
  children,
}: Parameters<typeof SettingsArea>[0]) {
  const { t } = useI18n();
  const nav = t.ops.nav;
  const report = usePageChromeReport();
  const group = active === SETTINGS_HOME.id ? null : settingsGroupOf(active);
  const leading = (
    <>
      <GroupedNavSheet
        groups={settingsNavGroups(nav)}
        pinned={settingsNavPinned(nav)}
        active={active}
        label={nav.label}
        title={nav.title}
        storageKey={SETTINGS_MENU_STORAGE}
        header={(close) => (
          <div className="px-1">
            <SettingsSearchField onOpen={close} />
          </div>
        )}
        className="self-start md:hidden"
      />
    </>
  );
  const withIndex = !!sections && showOnThisPage(sections);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SettingAnchor />
      <SettingsPageHeader
        leading={leading}
        crumbs={group ? [{ label: nav.groups[group] }, { label: nav[active] }] : []}
        title={bare ? undefined : (title ?? nav[active])}
        description={bare ? undefined : description}
        updatedAt={report?.updatedAt}
        timeZone={report?.timeZone}
        job={job}
        historyHref={historyHref}
      />
      {tabs ? (
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">{tabs}</div>
          <PageChangedFilter className="mb-1" />
        </div>
      ) : (
        <div className="flex justify-end empty:hidden">
          <PageChangedFilter />
        </div>
      )}
      {withIndex ? (
        <div className="flex min-w-0 gap-8">
          <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
          <OnThisPage sections={sections} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
