/**
 * Onde assistir agrupado para a página do jogo: TV aberta, canais pagos e "disponível também em" (um
 * cartão por operadora ou streaming, com os planos). Usa o bloco `availability` da API; resposta sem
 * ele (cópia gravada antiga) cai para as opções publicadas, sem cartões de plataforma. Com o canal do
 * jogo a confirmar (`channel_status = to_confirm`), os grupos são os dos detentores dos direitos.
 */
import type {
  AvailabilityLogo,
  PlatformAvailability,
  WhereToWatch,
  WhereToWatchOption,
} from '@galaxie/contracts';

/** Logo de canal com o link da opção publicada (quando houver) e as praças regionais. */
export interface WatchLogo {
  key: string;
  name: string;
  logo: string | null;
  logoDark: string | null;
  href: string | null;
  regions: string[];
  /** Meio da opção (só nas de outros meios, para a legenda). */
  medium: WhereToWatchOption['medium'] | null;
}

export interface WatchGroups {
  freeTv: WatchLogo[];
  payTv: WatchLogo[];
  /** Cartões "disponível também em" (a operadora do tenant primeiro, como a API ordena). */
  platforms: PlatformAvailability[];
  /** Opções de outros meios (streaming, YouTube, app) que não viraram cartão de plataforma. */
  others: WatchLogo[];
  /** Operadora do tenant; com `plans: []` quando o jogo não está na grade dela. */
  yourOperator: PlatformAvailability | null;
  /** O canal do jogo ainda não foi confirmado: os grupos são os dos detentores dos direitos no país. */
  toConfirm: boolean;
}

const fromOptions = (options: WhereToWatchOption[], id: string) =>
  options.filter((o) => (o.provider_id ?? o.id) === id);

function logoOf(item: AvailabilityLogo, options: WhereToWatchOption[]): WatchLogo {
  const matches = fromOptions(options, item.id);
  return {
    key: `${item.id}|${item.name}`,
    name: item.name,
    logo: item.logo,
    logoDark: item.logo_dark,
    href: matches.find((o) => o.watch_url)?.watch_url ?? null,
    regions: [...new Set(matches.flatMap((o) => (o.region ? [o.region] : [])))],
    medium: null,
  };
}

/** Canais de um meio direto das opções (resposta sem `availability`), sem repetir praças. */
function optionLogos(options: WhereToWatchOption[], keep: (o: WhereToWatchOption) => boolean): WatchLogo[] {
  const out = new Map<string, WatchLogo>();
  for (const o of options) {
    if (!keep(o)) continue;
    const name = o.channel && o.channel !== o.provider ? o.channel : o.provider;
    const key = `${o.provider_id ?? o.provider}|${name}`;
    const prev = out.get(key);
    if (prev) {
      if (o.region && !prev.regions.includes(o.region)) prev.regions.push(o.region);
      prev.href ??= o.watch_url;
      continue;
    }
    out.set(key, {
      key,
      name,
      logo: o.logo,
      logoDark: o.logo_dark,
      href: o.watch_url,
      regions: o.region ? [o.region] : [],
      medium: o.medium,
    });
  }
  return [...out.values()];
}

/** Detentores "a confirmar" de outros meios (streaming, app), no formato das opções. */
function toConfirmOthers(wtw: WhereToWatch, inCards: Set<string>): WatchLogo[] {
  const out = new Map<string, WatchLogo>();
  for (const c of wtw.to_confirm ?? []) {
    if (c.medium === 'free_tv' || c.medium === 'pay_tv') continue;
    if (c.provider_id && inCards.has(c.provider_id)) continue;
    const key = `${c.provider_id ?? c.provider}|${c.provider}`;
    if (out.has(key)) continue;
    out.set(key, {
      key,
      name: c.provider,
      logo: c.logo,
      logoDark: c.logo_dark,
      href: null,
      regions: [],
      medium: c.medium,
    });
  }
  return [...out.values()];
}

export function groupWhereToWatch(wtw: WhereToWatch): WatchGroups {
  const options = wtw.options;
  // cópias gravadas antes do bloco não o têm: o tipo diz que sempre vem, a resposta antiga não
  const availability = (wtw as Partial<WhereToWatch>).availability ?? null;
  const platforms = availability?.platforms ?? [];
  const toConfirm = availability?.channel_status === 'to_confirm';
  const inCards = new Set(
    platforms.flatMap((p) => (p.platform.broadcaster_id ? [p.platform.broadcaster_id] : [])),
  );
  return {
    freeTv: availability
      ? availability.free_tv.map((c) => logoOf(c, options))
      : optionLogos(options, (o) => o.medium === 'free_tv'),
    payTv: availability
      ? availability.pay_tv_channels.map((c) => logoOf(c, options))
      : optionLogos(options, (o) => o.medium === 'pay_tv'),
    platforms,
    others: toConfirm
      ? toConfirmOthers(wtw, inCards)
      : optionLogos(
          options,
          (o) =>
            o.medium !== 'free_tv' && o.medium !== 'pay_tv' && !(o.provider_id && inCards.has(o.provider_id)),
        ),
    yourOperator: availability?.your_operator ?? null,
    toConfirm,
  };
}

/**
 * Há o que mostrar agrupado (senão, a página mostra os "a confirmar" ou a mensagem de vazio). A
 * operadora do tenant sozinha, sem o jogo na grade, não basta: ela aparece junto dos outros grupos.
 */
export const hasGroups = (g: WatchGroups) =>
  g.freeTv.length + g.payTv.length + g.platforms.length + g.others.length > 0;
