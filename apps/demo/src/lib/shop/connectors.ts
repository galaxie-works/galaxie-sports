/**
 * Ajustes → Engajamento → Shopping → Conectores (#916), só no servidor: liga e desliga a loja sem deploy, a matriz
 * loja × caminho que o widget do cliente lê (#925, #929), a configuração não secreta na rede e as credenciais da conta
 * da Galaxie. As credenciais são só de gravação: cifradas com o cofre do painel (`SETTINGS_KEK`, a mesma chave de
 * Credenciais) e nunca devolvidas à tela; dela só aparece o final do código de afiliado e quando mudou.
 */
import { shopStoreSecretKey } from '@galaxie/engage';

import { pool } from '@/lib/auth/db';
import { settingsSecrets } from '@/lib/ops/panel-secrets';

import type { ConnectorInput, CredentialsInput, ShopClientPath, ShopNetwork } from './catalog-input';
import { ShopCatalogError } from './catalog';

export interface ShopConnectorView {
  id: string;
  name: string;
  country: string;
  network: ShopNetwork;
  active: boolean;
  clientPaths: ShopClientPath[];
  advertiserId: string | null;
  linkTemplate: string | null;
  hasCredentials: boolean;
  /** Muda a cada gravação: a tela remonta o cartão e não mostra o valor velho. */
  updatedAt: string;
  credentialsHint: string | null;
  credentialsUpdatedAt: string | null;
}

/** Sem código de afiliado (nem gravado antes, nem agora). */
export class ShopCredentialsError extends Error {
  constructor() {
    super('affiliate_id');
    this.name = 'ShopCredentialsError';
  }
}

export class ShopSecretError extends Error {
  constructor() {
    super('no_kek');
    this.name = 'ShopSecretError';
  }
}

export async function listShopConnectors(): Promise<ShopConnectorView[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    country: string;
    network: ShopNetwork;
    active: boolean;
    client_paths: ShopClientPath[];
    config: Record<string, string> | null;
    has_credentials: boolean;
    credentials_hint: string | null;
    credentials_updated_at: Date | null;
    updated_at: Date;
  }>(
    `select id, name, country, network, active, client_paths, config, credentials_sealed is not null as has_credentials,
            credentials_hint, credentials_updated_at, updated_at
       from engage.shop_store order by country, position, name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    network: r.network,
    active: r.active,
    clientPaths: r.client_paths ?? [],
    advertiserId: r.config?.advertiserId ?? null,
    linkTemplate: r.config?.linkTemplate ?? null,
    hasCredentials: r.has_credentials,
    credentialsHint: r.credentials_hint,
    credentialsUpdatedAt: r.credentials_updated_at?.toISOString() ?? null,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function storeNetwork(id: string): Promise<ShopNetwork> {
  const { rows } = await pool.query<{ network: ShopNetwork }>(
    `select network from engage.shop_store where id = $1`,
    [id],
  );
  if (!rows[0]) throw new ShopCatalogError('not_found');
  return rows[0].network;
}

export async function setShopStoreActive(id: string, active: boolean, actor: string): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.shop_store set active = $2, updated_by = $3, updated_at = now() where id = $1`,
    [id, active, actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

export async function saveShopConnector(id: string, input: ConnectorInput, actor: string): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.shop_store set client_paths = $2, config = $3, updated_by = $4, updated_at = now() where id = $1`,
    [id, input.clientPaths, JSON.stringify(input.config), actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

/** Final do código de afiliado para a tela reconhecer qual está gravado (só de código longo). */
export function credentialsHint(affiliateId: string | undefined): string | null {
  return affiliateId && affiliateId.length >= 8 ? `…${affiliateId.slice(-4)}` : null;
}

/**
 * Grava as credenciais juntando com as que já estão gravadas: campo vazio mantém o valor (corrigir o código não
 * apaga o token da API). O código de afiliado é obrigatório no resultado.
 */
export async function saveShopCredentials(id: string, input: CredentialsInput, actor: string): Promise<void> {
  const box = settingsSecrets();
  if (!box) throw new ShopSecretError();
  const { rows } = await pool.query<{ sealed: string | null }>(
    `select credentials_sealed as sealed from engage.shop_store where id = $1`,
    [id],
  );
  if (!rows[0]) throw new ShopCatalogError('not_found');
  let current: CredentialsInput = {};
  const opened = rows[0].sealed ? box.open(shopStoreSecretKey(id), rows[0].sealed) : null;
  if (opened) {
    try {
      current = JSON.parse(opened) as CredentialsInput;
    } catch {
      current = {};
    }
  }
  const merged: CredentialsInput = { ...current, ...input };
  if (!merged.affiliateId) throw new ShopCredentialsError();
  const sealed = box.seal(shopStoreSecretKey(id), JSON.stringify(merged));
  input = merged;
  const { rowCount } = await pool.query(
    `update engage.shop_store set credentials_sealed = $2, credentials_hint = $3, credentials_updated_at = now(),
            credentials_updated_by = $4, updated_by = $4, updated_at = now()
      where id = $1`,
    [id, sealed, credentialsHint(input.affiliateId), actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

export async function clearShopCredentials(id: string, actor: string): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.shop_store set credentials_sealed = null, credentials_hint = null, credentials_updated_at = now(),
            credentials_updated_by = $2, updated_by = $2, updated_at = now()
      where id = $1`,
    [id, actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}
