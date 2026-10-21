'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

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
} from '@/components/ui/sidebar';
import { COUNTRIES, MAIN_NAV, MULTISPORT_NAV, SPORTS, type NavItem } from '@/lib/navigation';

function isActive(pathname: string | null, href: string) {
  if (pathname === null) return false;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string | null }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive(pathname, item.href)}
        tooltip={item.label}
        render={<Link href={item.href} />}
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** O caminho atual é dado de URL (runtime): fica atrás de Suspense para não bloquear o prerender. */
function CurrentSidebarNav() {
  return <SidebarNav pathname={usePathname()} />;
}

function SidebarNav({ pathname }: { pathname: string | null }) {
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {MAIN_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Esportes</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {SPORTS.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
            <NavLink item={MULTISPORT_NAV} pathname={pathname} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Países</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {COUNTRIES.map((c) => (
              <SidebarMenuItem key={c.code}>
                <SidebarMenuButton isActive={isActive(pathname, c.href)} render={<Link href={c.href} />}>
                  <span className="bg-muted text-muted-foreground flex h-4 min-w-7 items-center justify-center px-1 font-mono text-xs">
                    {c.code.replace('GB-', '')}
                  </span>
                  <span>{c.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
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
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center text-sm font-bold">
                G
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">Galaxie Sports</span>
                <span className="text-muted-foreground truncate text-xs">Demo da API</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <Suspense fallback={<SidebarNav pathname={null} />}>
        <CurrentSidebarNav />
      </Suspense>

      <SidebarFooter>
        <p className="text-muted-foreground px-2 text-xs group-data-[collapsible=icon]:hidden">
          Dados servidos pela API Galaxie Sports.
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
