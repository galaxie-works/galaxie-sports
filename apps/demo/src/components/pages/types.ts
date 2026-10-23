import type { DataSource } from '@/lib/galaxie/source';

/** Props do conteúdo das páginas de jogo, time, campeonato e pessoa (rota do app ou exemplo público). */
export interface PageContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  source: DataSource;
}
