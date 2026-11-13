/**
 * O widget do Shopping no site do cliente (#925): de cada loja que o cliente ligou, o destino do link. Junta três
 * coisas, nesta ordem, e só libera o que passar nas três:
 * 1. a matriz da Galaxie (#916): a loja está ligada e o caminho escolhido está liberado para clientes;
 * 2. a checagem de destino (#927), confirmada na versão atual das regras: TV, público infantil, site sem conta…;
 * 3. o que o cliente configurou: código próprio válido ou repasse pela Galaxie (com o clickref do cliente).
 * O código da Galaxie nunca sai daqui: o destino é sempre `client`.
 */
import { createHash } from 'node:crypto';
import type { WidgetShopConfig } from '@galaxie/db';
import {
  evaluateShopDestination,
  parseShopDestinationAnswers,
  shopDestinationConfirmed,
  type ShopDestination,
  type ShopStoreConnector,
} from '@galaxie/engage';

const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Clickref do cliente na sub-rede: estável por tenant e sem o id dele à mostra (#929 concilia por ele). */
export function tenantClickref(tenantId: string): string {
  return `gs${createHash('sha256').update(`shop-clickref:${tenantId.toLowerCase()}`).digest('hex').slice(0, 14)}`;
}

export interface WidgetStoreDestination {
  dest: ShopDestination;
  /** TV: no máximo o QR code da loja, sem botão. */
  qrOnly: boolean;
}

/**
 * Destino de cada loja do widget. Sem checagem confirmada na versão atual, nenhuma loja (o cliente confirma de novo
 * no Builder). Loja fora da configuração do cliente também fica de fora: nada ligado por padrão.
 */
export function widgetShopDestinations(
  tenantId: string,
  config: WidgetShopConfig | undefined,
  stores: ReadonlyMap<string, ShopStoreConnector>,
): Map<string, WidgetStoreDestination> {
  const out = new Map<string, WidgetStoreDestination>();
  const d = config?.destination;
  if (!config || !d || !shopDestinationConfirmed(d.rulesVersion)) return out;
  const answers = parseShopDestinationAnswers(d.answers, { engagementBlock: d.engagementBlock === true });
  if (!answers) return out;
  const chosen = config.stores.filter((s) => stores.get(s.storeId)?.active);
  const evaluated = evaluateShopDestination(
    answers,
    chosen.map((s) => {
      const st = stores.get(s.storeId)!;
      return { id: st.id, network: st.network, clientPaths: st.clientPaths };
    }),
    { engagementBlock: d.engagementBlock === true },
  );
  const byStore = new Map(evaluated.stores.map((r) => [r.storeId, r]));
  for (const s of chosen) {
    const r = byStore.get(s.storeId);
    if (!r?.allowed || !r.paths.includes(s.path)) continue;
    if (s.path === 'client_code' && !TOKEN.test(s.clientCode ?? '')) continue;
    out.set(s.storeId, {
      dest:
        s.path === 'client_code'
          ? { kind: 'client', tenantId, path: 'client_code', clientCode: s.clientCode! }
          : { kind: 'client', tenantId, path: 'subnetwork', clickref: tenantClickref(tenantId) },
      qrOnly: r.qrOnly,
    });
  }
  return out;
}

/** A ordem das lojas é a do cliente no widget. */
export function widgetStoreOrder(config: WidgetShopConfig | undefined): Map<string, number> {
  return new Map((config?.stores ?? []).map((s, i) => [s.storeId, i]));
}
