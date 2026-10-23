/**
 * Registry dos widgets para o CLI do shadcn: `npx shadcn@latest add https://sports.galaxie.works/r/<id>.json`.
 * Público (o CLI baixa sem sessão; ver `lib/public-routes.ts`): devolve o registry-item do widget salvo
 * (`buildRegistryItem` de `@galaxie/widgets/registry`), com o tema, o idioma, o mercado e a entidade padrão
 * dele. Não há segredo no JSON: o id é opaco (UUID v7) e a chave publicável não vai junto (o componente lê
 * `NEXT_PUBLIC_GALAXIE_PUBLISHABLE_KEY` no app da operadora). Widget arquivado ou inexistente = 404.
 */
import { buildRegistryItem } from '@galaxie/widgets/registry';

import { isWidgetLocale, parseRegistryParam } from '@/lib/builder/config';
import { builderDb, getWidget } from '@/lib/builder/store';
import { PUBLIC_API_URL } from '@/lib/galaxie/request';

const HEADERS = {
  // O CLI e ferramentas de registry podem ler de outra origem; o conteúdo é público.
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

const problem = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { ...HEADERS, 'cache-control': 'no-store' } });

export async function GET(_request: Request, ctx: RouteContext<'/r/[id]'>) {
  const id = parseRegistryParam((await ctx.params).id);
  if (!id) return problem(404, 'not_found');
  const widget = await getWidget(builderDb(), id);
  if (!widget || widget.archivedAt) return problem(404, 'not_found');
  const { theme, locale, market, defaults } = widget.config;
  try {
    const item = buildRegistryItem({
      kind: widget.kind,
      name: widget.name,
      theme,
      apiBaseUrl: PUBLIC_API_URL,
      locale: isWidgetLocale(locale) ? locale : undefined,
      market,
      defaults,
    });
    return Response.json(item, {
      headers: { ...HEADERS, 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (err) {
    // Configuração gravada que o gerador recusa (tema ou mercado inválido): não serve um item quebrado.
    console.error('[registry] widget com configuração inválida', id, err);
    return problem(422, 'invalid_widget');
  }
}
