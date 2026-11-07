/**
 * Esqueletos de carregamento do app, montados a partir dos exemplos ReUI c-skeleton-1 … c-skeleton-10
 * (cópia fiel em `components/examples/c-skeleton-*.tsx`). Cada um mantém a composição do exemplo e só
 * ganha parâmetros (linhas, colunas, quantidade) para ficar com a forma da tela real: assim nada pula
 * quando os dados chegam.
 *
 * - c-skeleton-1 `AvatarInfoSkeleton`: avatar/escudo + 2 linhas (cabeçalho de pessoa, time, usuário).
 * - c-skeleton-2 `MediaCardSkeleton`: card com 2 linhas de título sobre um bloco 16:9 (ou só a mídia).
 * - c-skeleton-3 `TextSkeleton`: parágrafos (contexto da partida, textos editoriais).
 * - c-skeleton-4 `FormSkeleton`: rótulos sobre campos e um botão (editores e formulários).
 * - c-skeleton-5 `TableSkeleton`: cabeçalho com borda e linhas em colunas (tabelas e grades de dados).
 * - c-skeleton-6 `StatsSkeleton`: cards de métrica (rótulo, valor, legenda).
 * - c-skeleton-7 `ListSkeleton`: lista com título, botão e linhas com avatar e ação.
 * - c-skeleton-8 `CardGridSkeleton`: grade de cards com mídia, título, texto e rodapé.
 * - c-skeleton-9 `DetailsSkeleton`: o card de detalhes do perfil (rótulo/valor), nas colunas laterais.
 * - c-skeleton-10 `TimelineSkeleton`: lances alternando os lados (mandante à esquerda, visitante à direita).
 *
 * Sem `Math.random`: larguras fixas, para o prerender e a hidratação darem o mesmo HTML (teste em
 * `skeletons.test.tsx`). Os blocos não têm texto: quem anuncia o carregamento é o `LoadingStatus`
 * (`loading-status.tsx`), que envolve cada fallback e esconde os blocos dos leitores de tela. Com
 * `prefers-reduced-motion`, o pulso para (`globals.css`).
 */
import { Frame, FramePanel } from '@/components/reui/frame';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Visual do `TILE` de `explore/sport-card` sem a classe `tile-card`, que traz o hover e o foco. */
const TILE_BASE = 'bg-card text-card-foreground flex flex-col overflow-hidden rounded-xl border';
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-1 · Avatar Info
 * -----------------------------------------------------------------------------------------------*/

export function AvatarInfoSkeleton({
  avatarClassName = 'size-12 rounded-full',
  lines = ['h-4 w-[200px]', 'h-4 w-[140px]'],
  className,
}: {
  /** Tamanho e forma do avatar (escudo de time/competição é quadrado: `rounded-md`). */
  avatarClassName?: string;
  /** Uma barra por linha de texto, de cima para baixo. */
  lines?: readonly string[];
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <Skeleton className={cn('shrink-0', avatarClassName)} />
      <div className="flex min-w-0 flex-col gap-2">
        {lines.map((l, i) => (
          <Skeleton key={i} className={cn('max-w-full', l)} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-2 · Card
 * -----------------------------------------------------------------------------------------------*/

export function MediaCardSkeleton({
  mediaClassName = 'aspect-video',
  header = true,
  className,
}: {
  /** Tamanho do bloco de mídia (o local usa `h-64`, a altura da foto do estádio). */
  mediaClassName?: string;
  /** `false`: o card só com a mídia, sem as linhas de título (como a foto do local). */
  header?: boolean;
  className?: string;
}) {
  if (!header) {
    return (
      <Card className={cn('w-full py-0', className)}>
        <Skeleton className={cn('w-full rounded-none', mediaClassName)} />
      </Card>
    );
  }
  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn('w-full rounded-md', mediaClassName)} />
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-3 · Text Paragraphs
 * -----------------------------------------------------------------------------------------------*/

export function TextSkeleton({
  paragraphs = [3, 2],
  className,
}: {
  /** Linhas de cada parágrafo; a última de cada um é mais curta. */
  paragraphs?: readonly number[];
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      {paragraphs.map((n, p) => (
        <div key={p} className={cn('flex flex-col gap-2', p > 0 && 'mt-4')}>
          {range(n).map((i) => (
            <Skeleton key={i} className={cn('h-4', i === n - 1 ? (p % 2 ? 'w-5/6' : 'w-3/4') : 'w-full')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-4 · Form
 * -----------------------------------------------------------------------------------------------*/

const LABEL_WIDTHS = ['w-20', 'w-24', 'w-16', 'w-28'] as const;

export function FormSkeleton({
  fields = 2,
  columns = 1,
  button = true,
  className,
}: {
  fields?: number;
  /** 2 = campos lado a lado a partir de `sm` (como os editores do Builder). */
  columns?: 1 | 2;
  button?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col gap-6', className)}>
      <div className={cn('grid gap-6', columns === 2 && 'sm:grid-cols-2')}>
        {range(fields).map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className={cn('h-4', LABEL_WIDTHS[i % LABEL_WIDTHS.length])} />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      {button ? <Skeleton className="h-10 w-28" /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-5 · Data Table
 * -----------------------------------------------------------------------------------------------*/

export function TableSkeleton({
  rows = 4,
  columns = ['flex-1', 'w-24', 'w-20'],
  className,
}: {
  rows?: number;
  /** Largura de cada coluna (a primeira costuma esticar: `flex-1`). */
  columns?: readonly string[];
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      <div className="flex gap-4 border-b pb-2">
        {columns.map((c, i) => (
          <Skeleton key={i} className={cn('h-4 shrink-0', c)} />
        ))}
      </div>
      {range(rows).map((r) => (
        <div key={r} className="flex gap-4">
          {columns.map((c, i) => (
            <Skeleton key={i} className={cn('h-4 shrink-0', c)} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-6 · Stats Row
 * -----------------------------------------------------------------------------------------------*/

export function StatsSkeleton({
  count = 3,
  className = 'grid-cols-3',
}: {
  count?: number;
  /** Colunas da grade (ex.: `grid-cols-2 sm:grid-cols-3 xl:grid-cols-6`). */
  className?: string;
}) {
  return (
    <div className={cn('grid w-full gap-4', className)}>
      {range(count).map((i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-3 w-16" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-7 w-24 max-w-full" />
            <Skeleton className="h-3 w-20 max-w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * O par rótulo/valor do c-skeleton-6 sem o card em volta. `sm`: valor em texto (`text-sm`), como nas
 * fichas `<dl>`; o padrão é o número grande dos cards de métrica.
 */
export function StatPairSkeleton({
  size = 'default',
  className,
}: {
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', size === 'sm' ? 'gap-1' : 'gap-2', className)}>
      <Skeleton className="h-3 w-16" />
      <Skeleton className={cn('max-w-full', size === 'sm' ? 'h-4 w-24' : 'h-7 w-24')} />
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-7 · List With Actions
 * -----------------------------------------------------------------------------------------------*/

export function ListSkeleton({
  rows = 3,
  header = true,
  avatarClassName = 'size-9 rounded-full',
  action = true,
  className,
}: {
  rows?: number;
  /** Título e botão acima da lista. */
  header?: boolean;
  avatarClassName?: string;
  /** Botão no fim de cada linha. */
  action?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col', className)}>
      {header ? (
        <>
          <div className="flex items-center justify-between pb-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
          <Separator className="opacity-60" />
        </>
      ) : null}
      {range(rows).map((i) => (
        <div key={i} className="border-border/60 flex items-center gap-3 border-b py-3 last:border-b-0">
          <Skeleton className={cn('shrink-0', avatarClassName)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32 max-w-full" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          {action ? <Skeleton className="h-7 w-16 shrink-0 rounded-md" /> : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-8 · Card Grid
 * -----------------------------------------------------------------------------------------------*/

export function CardGridSkeleton({
  count = 6,
  className = 'sm:grid-cols-2 lg:grid-cols-3',
  media = 'aspect-video',
  footer = true,
  bare = false,
}: {
  count?: number;
  /** Colunas da grade. */
  className?: string;
  /** Bloco de mídia no topo (`null` sem mídia). */
  media?: string | null;
  footer?: boolean;
  /**
   * Dentro de um Frame não vai Card (ReUI): `bare` troca o Card pela caixa com borda que a tela usa.
   */
  bare?: boolean;
}) {
  const body = (
    <>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </>
  );
  const foot = (
    <>
      <Skeleton className="h-8 w-20 rounded-md" />
      <Skeleton className="h-8 w-8 rounded-md" />
    </>
  );
  return (
    <div className={cn('grid w-full gap-3', className)}>
      {range(count).map((i) =>
        bare ? (
          <div key={i} className="flex flex-col gap-3 rounded-lg border p-4">
            {media ? <Skeleton className={cn('w-full', media)} /> : null}
            <div className="space-y-2">{body}</div>
            {footer ? <div className="flex justify-between">{foot}</div> : null}
          </div>
        ) : (
          <Card key={i}>
            {media ? (
              <CardHeader>
                <Skeleton className={cn('w-full', media)} />
              </CardHeader>
            ) : null}
            <CardContent className="space-y-2">{body}</CardContent>
            {footer ? <CardFooter className="flex justify-between">{foot}</CardFooter> : null}
          </Card>
        ),
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-9 · Profile Page
 * -----------------------------------------------------------------------------------------------*/

/** Card de detalhes do c-skeleton-9: título, separador e linhas rótulo/valor (colunas laterais). */
export function DetailsSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Separator />
        {range(rows).map((i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className={cn('h-3', i % 2 ? 'w-24' : 'w-32')} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------------------------------
 * c-skeleton-10 · Chat Messages
 * -----------------------------------------------------------------------------------------------*/

/**
 * Minuto a minuto no formato das mensagens do c-skeleton-10: lance do mandante à esquerda (com o ícone
 * no lugar do avatar), do visitante à direita.
 */
export function TimelineSkeleton({ items = 4, className }: { items?: number; className?: string }) {
  const bubbles = ['h-12 w-48', 'h-10 w-40', 'h-16 w-56', 'h-10 w-44'] as const;
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4">
        {range(items).map((i) =>
          i % 2 === 0 ? (
            <div key={i} className="flex items-start gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className={cn('h-3', i % 4 ? 'w-20' : 'w-16')} />
                <Skeleton
                  className={cn('max-w-full rounded-lg rounded-tl-none', bubbles[i % bubbles.length])}
                />
                <Skeleton className="h-2.5 w-12" />
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start justify-end gap-2.5">
              <div className="flex flex-col items-end gap-1">
                <Skeleton
                  className={cn('max-w-full rounded-lg rounded-tr-none', bubbles[i % bubbles.length])}
                />
                <Skeleton className="h-2.5 w-12" />
              </div>
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Composições do app
 * -----------------------------------------------------------------------------------------------*/

/** Painel em Frame (Cliente e Ajustes): título e descrição do FrameHeader sobre o conteúdo. */
export function FramePanelSkeleton({
  children,
  action = false,
  className,
}: {
  children: React.ReactNode;
  /** Botão à direita do título (ex.: "Novo tema"). */
  action?: boolean;
  className?: string;
}) {
  return (
    <Frame className={className}>
      <FramePanel className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
          {action ? <Skeleton className="h-8 w-28 rounded-md" /> : null}
        </div>
        {children}
      </FramePanel>
    </Frame>
  );
}

/** Painel de tabela (Frame + c-skeleton-5): chaves, widgets, usuários, revisão, grades. */
export function TablePanelSkeleton({
  rows = 6,
  columns = ['flex-1', 'w-28', 'w-24', 'w-16'],
  action = false,
  toolbar = false,
}: {
  rows?: number;
  columns?: readonly string[];
  action?: boolean;
  /** Barra de busca/filtros acima da tabela. */
  toolbar?: boolean;
}) {
  return (
    <FramePanelSkeleton action={action}>
      {toolbar ? (
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      ) : null}
      <TableSkeleton rows={rows} columns={columns} />
    </FramePanelSkeleton>
  );
}

/** Editor com prévia ao lado (Builder e Temas): formulário (c-skeleton-4) | prévia em card. */
export function EditorSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <FramePanelSkeleton>
        <div className="flex gap-2">
          {range(3).map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        <FormSkeleton fields={fields} columns={2} />
      </FramePanelSkeleton>
      <FramePanelSkeleton>
        <Skeleton className="aspect-[4/5] w-full rounded-lg" />
      </FramePanelSkeleton>
    </div>
  );
}

/** Card de jogo (EventCard): competição, os dois lados com escudo e placar, data e local no rodapé. */
export function EventCardSkeleton() {
  return (
    <Card size="sm" className="gap-3">
      <div className="flex items-center gap-2 px-3">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3">
        {[0, 1].map((side) => (
          <div key={side} className={cn('flex flex-col items-center gap-1.5', side && 'col-start-3')}>
            <Skeleton className="size-12 rounded-md" />
            <Skeleton className="h-3.5 w-20 max-w-full" />
          </div>
        ))}
        <div className="col-start-2 row-start-1 flex h-16 items-center justify-center">
          <Skeleton className="h-7 w-14" />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t px-3 pt-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </Card>
  );
}

export function EventCardsSkeleton({
  count = 6,
  className = 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {range(count).map((i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Card de competição (escudo + nome + tipo/temporada), como em países e esportes. */
export function EntryCardsSkeleton({
  count = 8,
  className = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  avatarClassName = 'size-10 rounded-md',
}: {
  count?: number;
  className?: string;
  avatarClassName?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {range(count).map((i) => (
        <Card key={i} size="sm">
          <CardHeader>
            <AvatarInfoSkeleton
              avatarClassName={avatarClassName}
              lines={[i % 3 === 1 ? 'h-4 w-28' : 'h-4 w-36', 'h-3 w-24']}
              className="gap-3"
            />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/** Título de seção (Section) sobre o conteúdo: h2 curto e descrição. */
export function SectionSkeleton({
  children,
  description = true,
  className,
}: {
  children: React.ReactNode;
  description?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-36" />
        {description ? <Skeleton className="h-3 w-56 max-w-full" /> : null}
      </div>
      {children}
    </div>
  );
}

/** Tabela dentro de um card (seções das páginas de esporte): c-skeleton-5 com a moldura do Card. */
export function TableCardSkeleton({
  rows = 6,
  columns = ['flex-1', 'w-12', 'w-12', 'w-12', 'w-16'],
  className,
}: {
  rows?: number;
  columns?: readonly string[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent>
        <TableSkeleton rows={rows} columns={columns} />
      </CardContent>
    </Card>
  );
}

/** Formulário dentro de um card (c-skeleton-4 com a moldura do Card). */
export function FormCardSkeleton({ fields = 2, className }: { fields?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent>
        <FormSkeleton fields={fields} />
      </CardContent>
    </Card>
  );
}

/** Painel de operação (Ajustes → Sistema/Esportes): abas sobre a grade de painéis com tabela. */
export function OpsPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {range(4).map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {range(2).map((i) => (
          <FramePanelSkeleton key={i}>
            <TableSkeleton rows={5} columns={['flex-1', 'w-20', 'w-16']} />
          </FramePanelSkeleton>
        ))}
      </div>
    </div>
  );
}

/** Visão geral do cliente: dados do contrato (2 colunas), uso (c-skeleton-6) e próximos passos. */
export function TenantOverviewSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <FramePanelSkeleton className="lg:col-span-2">
        <div className="grid gap-5 sm:grid-cols-2">
          {range(4).map((i) => (
            <div key={i} className={cn('flex flex-col gap-2', i === 2 && 'sm:col-span-2')}>
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
      </FramePanelSkeleton>
      <FramePanelSkeleton>
        <div className="grid grid-cols-2 gap-3">
          <StatPairSkeleton />
          <StatPairSkeleton />
        </div>
        <Skeleton className="h-20 w-full" />
      </FramePanelSkeleton>
      <FramePanelSkeleton className="lg:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {range(2).map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
              <Skeleton className="size-5 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </FramePanelSkeleton>
    </div>
  );
}

/** Placar do jogo: os dois lados (escudo e nome) e o placar com o status no meio. */
export function ScoreboardSkeleton() {
  return (
    <Card>
      <CardContent className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 py-2">
        {[0, 1].map((side) => (
          <div
            key={side}
            className={cn('flex flex-col items-center gap-2', side ? 'col-start-3' : 'col-start-1')}
          >
            <Skeleton className="size-16 rounded-md sm:size-20" />
            <Skeleton className="h-5 w-28 max-w-full" />
          </div>
        ))}
        <div className="col-start-2 row-start-1 flex flex-col items-center gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Cards dos índices (Países e Esportes) com a base do `TILE` do Explorar (`tile-card`): cabeçalho do c-skeleton-1 (bandeira ou
 * ícone + nome) sobre os números do c-skeleton-6.
 */
export function IndexCardsSkeleton({
  count = 12,
  variant = 'country',
  className = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
}: {
  count?: number;
  /** `country`: bandeira ao lado do nome; `family`: ícone no topo e o nome embaixo (card mais alto). */
  variant?: 'country' | 'family';
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {range(count).map((i) => (
        <div key={i} className={cn(TILE_BASE, 'w-full gap-3 p-4', variant === 'family' && 'min-h-44 gap-4')}>
          {variant === 'country' ? (
            <AvatarInfoSkeleton
              avatarClassName="h-7 w-10 rounded-[3px]"
              lines={[i % 3 === 1 ? 'h-4 w-24' : 'h-4 w-32', 'h-3 w-28']}
              className="gap-3"
            />
          ) : (
            <>
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="mt-auto h-5 w-32" />
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <StatPairSkeleton />
            <StatPairSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ficha em pares rótulo/valor (`<dl>` das páginas de local, atleta, cavalo e prova). */
export function StatPairsSkeleton({
  count = 4,
  className = 'grid-cols-2 sm:grid-cols-4',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-4', className)}>
      {range(count).map((i) => (
        <StatPairSkeleton key={i} size="sm" />
      ))}
    </div>
  );
}

/**
 * Tela de Ajustes sem moldura: barra (filtros ou abas) sobre a tabela com borda (c-skeleton-5), como
 * Revisão e Grades.
 */
export function ToolbarTableSkeleton({
  toolbar = 'filters',
  rows = 8,
  columns = ['flex-1', 'w-28', 'w-24', 'w-20'],
}: {
  /** `filters`: campo de filtros e botões de estado; `tabs`: abas com a linha de baixo e os filtros da aba. */
  toolbar?: 'filters' | 'tabs';
  rows?: number;
  columns?: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {toolbar === 'tabs' ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 border-b pb-2">
            {range(3).map((i) => (
              <Skeleton key={i} className="h-6 w-24 rounded-md" />
            ))}
          </div>
          {/* A barra de filtros da aba aberta (país, plataforma, tipo e estado) e o botão de criar. */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {range(4).map((i) => (
                <Skeleton key={i} className="h-8 w-36 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full max-w-xl" />
          <div className="flex flex-wrap gap-2">
            {range(4).map((i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-md" />
            ))}
          </div>
        </div>
      )}
      <div className="rounded-lg border p-4">
        <TableSkeleton rows={rows} columns={columns} />
      </div>
    </div>
  );
}

/**
 * Busca com lista sem moldura (Ajustes → Escudos): campo, filtros e botão; a dica; o título da lista e
 * as linhas do c-skeleton-7 (escudo, nome e o botão de enviar).
 */
export function SearchListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full sm:max-w-sm" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-3 w-80 max-w-full" />
      <div className="flex flex-col">
        <Skeleton className="h-4 w-32" />
        <ListSkeleton rows={rows} header={false} avatarClassName="size-12 rounded-md" />
      </div>
    </div>
  );
}
