'use client';

import { ChevronsUpDown, LogOut, Users } from 'lucide-react';
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

/** Rodapé da sidebar: quem está logado, atalho para o painel de usuários (admin) e sair. */
export function UserMenu() {
  const router = useRouter();
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
              <DropdownMenuLabel>{isAdmin ? 'Admin' : 'Convidado'}</DropdownMenuLabel>
            </DropdownMenuGroup>
            {isAdmin ? (
              <DropdownMenuItem render={<Link href="/ajustes/usuarios" />}>
                <Users />
                Usuários e convites
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
