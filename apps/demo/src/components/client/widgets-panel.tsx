'use client';

import {
  Activity,
  ArrowLeftRight,
  Award,
  CalendarCheck,
  ChartColumn,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  ClipboardList,
  Dna,
  Flag,
  Goal,
  GalleryHorizontalEnd,
  History,
  Hourglass,
  IdCard,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  Medal,
  Percent,
  Network,
  Plus,
  Radio,
  Scale,
  Shield,
  Shirt,
  Sparkles,
  Sun,
  Swords,
  Table2,
  Timer,
  TrendingUp,
  Trophy,
  Tv,
  UserMinus,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { archiveWidgetAction } from '@/app/[locale]/(app)/cliente/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
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
import { Spinner } from '@/components/ui/spinner';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { UrlTabs } from '@/components/sport/url-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WIDGET_CATALOG } from '@galaxie/widgets';

import { OFFERED_WIDGET_KINDS, toWidgetLocale } from '@/lib/builder/config';
import { CATALOG_TAB_PARAM, catalogTabs, pickTab, type CatalogFamilyId } from '@/lib/builder/sports';
import type { WidgetEntityType, WidgetKind } from '@/lib/builder/types';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { EQUESTRIAN_NAV, FAMILIES, MULTISPORT_NAV } from '@/lib/navigation';

export const KIND_ICONS: Record<WidgetKind, LucideIcon> = {
  match_card: CalendarDays,
  match_timeline: Activity,
  live_list: Radio,
  score_ticker: GalleryHorizontalEnd,
  standings: Table2,
  where_to_watch: Tv,
  ai_context: Sparkles,
  match_stakes: Flag,
  related_videos: Clapperboard,
  head_to_head: Swords,
  team_schedule: CalendarRange,
  team_card: Shield,
  race_result: Trophy,
  race_weekend: Timer,
  season_calendar: CalendarClock,
  athlete_profile: UserRound,
  fight_card: ListOrdered,
  equestrian_results: ClipboardList,
  equestrian_ranking: TrendingUp,
  equestrian_calendar: CalendarCheck,
  rider_profile: UserCheck,
  horse_profile: Dna,
  medal_table: Medal,
  country_today: Sun,
  games_schedule: ListChecks,
  country_athletes: Users,
  medal_history: History,
  sidelined: UserMinus,
  champions_gallery: Award,
  competition_leaders: Goal,
  countdown: Hourglass,
  team_squad: Shirt,
  player_profile: IdCard,
  lineups: LayoutGrid,
  match_prediction: Percent,
  match_odds: Scale,
  team_stats: ChartColumn,
  transfer_market: ArrowLeftRight,
  bracket: Network,
};

/** Nome e descrição do tipo de widget no idioma da tela (vêm do catálogo de `@galaxie/widgets`). */
export function useKindTexts() {
  const { locale } = useI18n();
  const wl = toWidgetLocale(locale);
  return (kind: WidgetKind) => ({
    name: WIDGET_CATALOG[kind].name[wl],
    description: WIDGET_CATALOG[kind].description[wl],
  });
}

export interface WidgetRow {
  id: string;
  kind: WidgetKind;
  name: string;
  version: number;
  updatedAt: string;
  entity: { type: WidgetEntityType; id: string } | null;
  /** Família do esporte do widget (null = todos os esportes). */
  family: CatalogFamilyId | null;
}

/** Ícone animado da família (o mesmo do menu). */
function FamilyIcon({ id, className }: { id: CatalogFamilyId; className?: string }) {
  if (id === 'multiesporte') return <MULTISPORT_NAV.icon className={className} aria-hidden />;
  const nav = id === 'hipismo' ? EQUESTRIAN_NAV : FAMILIES.find((f) => f.id === id);
  if (!nav) return null;
  const Icon = nav.icon;
  return (
    <AnimatedSportIcon slug={nav.slug} className={className}>
      <Icon aria-hidden />
    </AnimatedSportIcon>
  );
}

/** Cartão de um tipo de widget no catálogo, com o link de criar já na aba (esporte) de onde veio. */
function KindCard({ kind, family }: { kind: WidgetKind; family: CatalogFamilyId }) {
  const { t } = useI18n();
  const kindTexts = useKindTexts();
  const Icon = KIND_ICONS[kind];
  const texts = kindTexts(kind);
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <span className="font-medium">{texts.name}</span>
        <span className="text-muted-foreground text-sm">{texts.description}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={`/cliente/builder/novo?tipo=${kind}&${CATALOG_TAB_PARAM}=${family}`} />}
      >
        <Plus />
        {t.client.builder.create}
      </Button>
    </div>
  );
}

function ArchiveButton({ row }: { row: WidgetRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const b = t.client.builder;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
        {pending ? <Spinner /> : null}
        {b.archive}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(b.archiveTitle, { name: row.name })}</AlertDialogTitle>
          <AlertDialogDescription>{b.archiveDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{b.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await archiveWidgetAction(row.id);
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(b.archived);
                router.refresh();
              })
            }
          >
            {b.archive}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Builder: o catálogo (para começar um widget) e os widgets salvos do tenant (editar e arquivar). */
export function WidgetsPanel({
  widgets,
  timeZone,
  sports,
  tab: tabParam,
}: {
  widgets: WidgetRow[];
  timeZone: string;
  /** Esportes do plano (vazio = todos): as abas são só das famílias liberadas. */
  sports: string[];
  /** Aba pedida na URL (`?esporte=`). */
  tab?: string | undefined;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const kindTexts = useKindTexts();
  const b = t.client.builder;
  const tabs = catalogTabs(OFFERED_WIDGET_KINDS, sports);
  const active = pickTab(tabs, tabParam);
  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>{b.catalog}</FrameTitle>
            <FrameDescription>{b.description}</FrameDescription>
          </FrameHeader>
          {active ? (
            <UrlTabs param={CATALOG_TAB_PARAM} value={active.family.id} className="gap-4">
              {/* rola só na horizontal e sem barra visível (o mesmo das abas do jogo) */}
              <TabsList
                aria-label={b.sportTabs}
                className="max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {tabs.map(({ family }) => (
                  <TabsTrigger key={family.id} value={family.id}>
                    <FamilyIcon id={family.id} className="size-4" />
                    {t.nav.families[family.id]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tabs.map(({ family, kinds }) => (
                <TabsContent key={family.id} value={family.id}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {kinds.map((kind) => (
                      <KindCard key={kind} kind={kind} family={family.id} />
                    ))}
                  </div>
                </TabsContent>
              ))}
            </UrlTabs>
          ) : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{b.saved}</FrameTitle>
            <FrameDescription>{b.savedDescription}</FrameDescription>
          </FrameHeader>
          {widgets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{b.columns.name}</TableHead>
                  <TableHead>{b.columns.kind}</TableHead>
                  <TableHead>{b.columns.sport}</TableHead>
                  <TableHead>{b.columns.entity}</TableHead>
                  <TableHead>{b.columns.version}</TableHead>
                  <TableHead>{b.columns.updated}</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {widgets.map((w) => {
                  const Icon = KIND_ICONS[w.kind];
                  return (
                    <TableRow key={w.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link href={`/cliente/builder/${w.id}`} className="hover:underline">
                          {w.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <Icon className="text-muted-foreground size-4" aria-hidden />
                          {kindTexts(w.kind).name}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {w.family ? (
                          <span className="flex items-center gap-1.5">
                            <FamilyIcon id={w.family} className="text-muted-foreground size-4" />
                            {t.nav.families[w.family]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{b.allSports}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {w.entity ? b.entityTypes[w.entity.type] : b.noEntity}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{fill(b.version, { n: w.version })}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {f.relative(w.updatedAt)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link href={`/cliente/builder/${w.id}`} />}
                          >
                            {b.edit}
                          </Button>
                          <ArchiveButton row={w} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-6 text-sm">{b.empty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
