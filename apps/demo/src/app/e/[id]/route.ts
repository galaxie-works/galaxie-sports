/**
 * Configuração pública de um widget para o embed HTML (`<galaxie-widget widget="<id>">`, ver
 * `@galaxie/widgets/src/embed/element.tsx`): o script servido em `/embed.js` lê `/e/<id>.json` e desenha o
 * widget com o tema, o idioma, o mercado e a entidade padrão salvos no Builder. Público como o registry
 * (`/r/<id>.json`): não há segredo aqui, o id é opaco e a chave publicável fica no atributo `key` da página,
 * presa às origens permitidas. Widget arquivado ou inexistente = 404.
 */
import { isWidgetLocale, parseRegistryParam } from '@/lib/builder/config';
import { builderDb, getWidget } from '@/lib/builder/store';
import { PUBLIC_API_URL } from '@/lib/galaxie/request';

const HEADERS = {
  // a página de qualquer portal lê a configuração (o conteúdo é público)
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

export async function GET(_request: Request, ctx: RouteContext<'/e/[id]'>) {
  const id = parseRegistryParam((await ctx.params).id);
  const widget = id ? await getWidget(builderDb(), id) : null;
  if (!widget || widget.archivedAt || !isWidgetLocale(widget.config.locale))
    return Response.json(
      { error: 'not_found' },
      { status: 404, headers: { ...HEADERS, 'cache-control': 'no-store' } },
    );
  const { theme, locale, market, defaults } = widget.config;
  return Response.json(
    {
      id: widget.id,
      kind: widget.kind,
      version: widget.version,
      theme,
      locale,
      market,
      defaults: defaults ?? {},
      apiBaseUrl: PUBLIC_API_URL,
    },
    { headers: { ...HEADERS, 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
