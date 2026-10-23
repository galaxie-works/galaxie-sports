'use client';

import { BookOpen, Compass } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useSyncExternalStore } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { LIVE_HREF, LiveNavItem } from '@/components/live/live-nav-item';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { CountryFlag } from '@/components/sport/country-flag';
import { SidebarSearchButton } from '@/components/search/search-button';
import { getActiveSection, getActiveSectionServer, subscribeActiveSection } from '@/lib/active-section';
import { DOCS_NAV } from '@/lib/docs';
import { useI18n } from '@/lib/i18n/client';
import { COUNTRIES, EQUESTRIAN_NAV, MULTISPORT_NAV, SPORTS, type NavItem } from '@/lib/navigation';
import { topLevelClick } from '@/lib/trail';

import { UserMenu } from './user-menu';

/** Ativo pelo caminho da URL ou, numa página fora do menu (jogo, time…), pelo pai de topo dela. */
function isActive(pathname: string | null, href: string, section: string | null = null) {
  if (pathname === null) return false;
  if (section === href) return true;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  label,
  pathname,
  section,
}: {
  item: NavItem & { slug?: string };
  label: string;
  pathname: string | null;
  section: string | null;
}) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive(pathname, item.href, section)}
        tooltip={label}
        render={<Link href={item.href} onClick={topLevelClick(item.href)} />}
      >
        {item.slug ? (
          <AnimatedSportIcon slug={item.slug} className="size-4">
            <Icon />
          </AnimatedSportIcon>
        ) : (
          <Icon />
        )}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const EXPLORE_NAV: NavItem = { href: '/', icon: Compass };

/** O caminho atual é dado de URL (runtime): fica atrás de Suspense para não bloquear o prerender. */
function CurrentSidebarNav() {
  const pathname = usePathname();
  const section = useSyncExternalStore(subscribeActiveSection, getActiveSection, getActiveSectionServer);
  const { isMobile, setOpenMobile } = useSidebar();
  // No celular o menu é uma gaveta por cima da página: fecha quando a navegação acontece. A gaveta
  // monta este componente ao abrir, então compara com o caminho de quando abriu (não fecha ao montar).
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (openedAt.current === pathname) return;
    openedAt.current = pathname;
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  return <SidebarNav pathname={pathname} section={section} />;
}

function SidebarNav({ pathname, section = null }: { pathname: string | null; section?: string | null }) {
  const { t } = useI18n();
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <NavLink item={EXPLORE_NAV} label={t.nav.explore.title} pathname={pathname} section={section} />
            <LiveNavItem active={isActive(pathname, LIVE_HREF)} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>{t.shell.sidebar.sports}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {SPORTS.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                label={t.nav.sports[item.slug]}
                pathname={pathname}
                section={section}
              />
            ))}
            <NavLink item={EQUESTRIAN_NAV} label={t.nav.equestrian} pathname={pathname} section={section} />
            <NavLink item={MULTISPORT_NAV} label={t.nav.multisport} pathname={pathname} section={section} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t.shell.sidebar.countries}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {COUNTRIES.map((c) => (
              <SidebarMenuItem key={c.code}>
                <SidebarMenuButton
                  isActive={isActive(pathname, c.href, section)}
                  render={<Link href={c.href} onClick={topLevelClick(c.href)} />}
                >
                  <CountryFlag code={c.code} />
                  <span>{t.nav.countries[c.code]}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel className="gap-2">
          <BookOpen aria-hidden />
          {t.shell.sidebar.docs}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {DOCS_NAV.map((d) => {
              const Icon = d.icon;
              return (
                <SidebarMenuItem key={d.href}>
                  {/* Rotas dos guias são irmãs (/docs e /docs/...): ativo só na própria página. */}
                  <SidebarMenuButton
                    isActive={pathname === d.href}
                    tooltip={t.code.docsNav[d.id].label}
                    render={<Link href={d.href} onClick={topLevelClick(d.href)} />}
                  >
                    <Icon />
                    <span>{t.code.docsNav[d.id].label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" onClick={topLevelClick('/')} />}>
              {/* Símbolo da Galaxie (planeta): cabe no slot do ícone e segue visível com a sidebar recolhida. */}
              <img
                src="/brand/galaxie-symbol.png"
                alt=""
                draggable={false}
                className="size-8 shrink-0 object-contain"
              />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">Galaxie Sports</span>
                <span className="text-muted-foreground truncate text-xs">Galactical Sports XP</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSearchButton />
      </SidebarHeader>

      <Suspense fallback={<SidebarNav pathname={null} />}>
        <CurrentSidebarNav />
      </Suspense>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
