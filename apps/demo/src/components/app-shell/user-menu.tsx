'use client';

import { ChevronsUpDown, Languages, LogOut, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth/client';
import { initials } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { clearTrail, topLevelClick } from '@/lib/trail';

import { LanguageSelect } from './language-select';

/**
 * Guarda o idioma escolhido no perfil (é o dos próximos e-mails da pessoa) e limpa a trilha, cujos rótulos
 * estão no idioma anterior.
 */
async function rememberLocale(locale: Locale) {
  clearTrail();
  await authClient.updateUser({ locale }).catch(() => {});
}

/** Rodapé da sidebar: quem está logado, idioma, atalho para o painel de usuários (admin) e sair. */
export function UserMenu() {
  const router = useRouter();
  const { t } = useI18n();
  const { data, isPending } = authClient.useSession();

  // Skeleton de largura fixa: o SidebarMenuSkeleton sorteia a largura (Math.random), o que o Next 16 não
  // aceita no prerender e que diverge na hidratação.
  if (isPending) {
    return (
      <div className="flex h-12 items-center gap-2 px-2">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }
  if (!data) return null;
  const { user } = data;
  const isAdmin = user.role === 'admin';

  async function signOut() {
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md text-xs">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="text-muted-foreground truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {isAdmin ? t.shell.userMenu.admin : t.shell.userMenu.guest}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {isAdmin ? (
              <DropdownMenuItem
                render={<Link href="/ajustes/usuarios" onClick={topLevelClick('/ajustes/usuarios')} />}
              >
                <Users />
                {t.shell.userMenu.users}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2">
                <Languages className="size-3.5" aria-hidden />
                {t.shell.userMenu.language}
              </DropdownMenuLabel>
              <div className="px-1.5 pb-1.5">
                <LanguageSelect className="w-full" onBeforeSwitch={rememberLocale} />
              </div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut />
              {t.shell.userMenu.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
