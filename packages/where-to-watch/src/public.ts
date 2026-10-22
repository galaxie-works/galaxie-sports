/** Leitura pública do onde assistir (GET /v1/events/{id}/where-to-watch, docs/05 §4). */
import { and, eq, isNull } from 'drizzle-orm';
import { broadcastOption, event, type Database } from '@galaxie/db';
import { listBroadcasters } from './library.js';
import type { BroadcastOptionRow } from './store.js';

/** Mensagem quando não há informação confiável — o evento continua existindo. */
export const UNKNOWN_MESSAGES: Record<string, string> = {
  'pt-BR': 'Não temos as informações de transmissão ainda.',
  'es-AR': 'Todavía no tenemos la información de transmisión.',
  'es-MX': 'Todavía no tenemos la información de transmisión.',
  'es-CO': 'Todavía no tenemos la información de transmisión.',
  'es-CL': 'Todavía no tenemos la información de transmisión.',
  'es-PE': 'Todavía no tenemos la información de transmisión.',
  'es-UY': 'Todavía no tenemos la información de transmisión.',
  'es-EC': 'Todavía no tenemos la información de transmisión.',
};

export function unknownMessage(locale: string): string {
  return (
    UNKNOWN_MESSAGES[locale] ??
    (locale.startsWith('es') ? UNKNOWN_MESSAGES['es-AR']! : UNKNOWN_MESSAGES['pt-BR']!)
  );
}

/** Ordem de exibição sugerida por meio (a ordenação final por direito de acesso é do cliente). */
export const MEDIUM_ORDER = [
  'free_tv',
  'youtube',
  'streaming_free',
  'pay_tv',
  'streaming_svod',
  'official_app',
  'radio',
] as const;

export interface PublicSource {
  publisher: string;
  url: string;
}

/** Logo da emissora (biblioteca): chave no nosso storage e URL de origem. */
export interface PublicLogo {
  storageKey: string | null;
  sourceUrl: string | null;
}

export interface PublicOption {
  row: BroadcastOptionRow;
  sources: PublicSource[];
  logo: PublicLogo | null;
}

export interface PublicWhereToWatch {
  eventId: string;
  country: string;
  status: 'resolved' | 'unknown';
  options: PublicOption[];
  /** Detentores de direitos sem o jogo confirmado ("canal a confirmar", status `probable`). */
  toConfirm: PublicOption[];
  updatedAt: Date | null;
}

/**
 * Opções publicadas (`confirmed`, versão vigente) de um evento × país. Com `region`, devolve as
 * nacionais + as daquela região; sem `region`, todas (cada uma com seu campo `region`).
 * Retorna null se o evento não existe.
 */
export async function getPublicWhereToWatch(
  db: Database,
  params: { eventId: string; country: string; region?: string | null },
): Promise<PublicWhereToWatch | null> {
  const [ev] = await db.select({ id: event.id }).from(event).where(eq(event.id, params.eventId));
  if (!ev) return null;
  const country = params.country.toUpperCase();
  const rows = await db
    .select()
    .from(broadcastOption)
    .where(
      and(
        eq(broadcastOption.eventId, params.eventId),
        eq(broadcastOption.countryCode, country),
        isNull(broadcastOption.supersededBy),
      ),
    );

  const region = params.region?.trim().toUpperCase() || null;
  const inRegion = (r: BroadcastOptionRow) =>
    !region || r.region === null || r.region.toUpperCase() === region;
  const order = (a: BroadcastOptionRow, b: BroadcastOptionRow) =>
    MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium) ||
    Number(b.confidence) - Number(a.confidence) ||
    a.providerName.localeCompare(b.providerName) ||
    (a.region ?? '').localeCompare(b.region ?? '');
  const confirmed = rows.filter((r) => r.status === 'confirmed' && inRegion(r)).sort(order);
  // "a confirmar" só aparece enquanto nenhuma opção estiver confirmada
  const probable = confirmed.length
    ? []
    : rows.filter((r) => r.status === 'probable' && inRegion(r)).sort(order);

  const ids = [
    ...new Set([...confirmed, ...probable].flatMap((r) => (r.broadcasterId ? [r.broadcasterId] : []))),
  ];
  const library = new Map((await listBroadcasters(db, { ids })).map((b) => [b.id, b]));
  const logoOf = (row: BroadcastOptionRow): PublicLogo | null => {
    const b = row.broadcasterId ? library.get(row.broadcasterId) : undefined;
    if (!b || (!b.logoStorageKey && !b.logoSourceUrl)) return null;
    return { storageKey: b.logoStorageKey, sourceUrl: b.logoSourceUrl };
  };

  const toPublic = (row: BroadcastOptionRow): PublicOption => {
    const seen = new Set<string>();
    const sources: PublicSource[] = [];
    for (const e of row.evidence) {
      if (e.stance === 'denies' || seen.has(e.url)) continue;
      seen.add(e.url);
      sources.push({ publisher: e.publisher ?? new URL(e.url).hostname, url: e.url });
    }
    return { row, sources, logo: logoOf(row) };
  };
  const options = confirmed.map(toPublic);
  const toConfirm = probable.map(toPublic);

  const stamps = rows.flatMap((r) => [r.createdAt.getTime(), r.lastVerifiedAt.getTime()]);
  return {
    eventId: params.eventId,
    country,
    status: options.length ? 'resolved' : 'unknown',
    options,
    toConfirm,
    updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}
