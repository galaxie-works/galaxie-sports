/**
 * Esportes que ficam fora das listagens do catálogo comercial (`/v1/sports`, `/v1/navigation`,
 * `/v1/explore/summary` e busca global): o hipismo tem API própria (`/v1/equestrian`, docs/13) e não faz
 * parte da oferta enquanto o licenciamento com a FEI e as federações não é concluído.
 */
export const OFF_CATALOG_SPORTS = ['equestrian'] as const;
