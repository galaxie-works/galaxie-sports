import type { AvailabilityLogo, PlatformAvailability } from '@galaxie/contracts';
import { CircleDashed } from 'lucide-react';

import { Badge } from '@/components/reui/badge';
import { Item, ItemContent, ItemHeader, ItemMedia, ItemTitle } from '@/components/ui/item';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { WatchGroups, WatchLogo } from '@/lib/where-to-watch';

type T = Dictionary['event']['whereToWatch'];

/** Preço do complemento como no mercado da moeda (R$ 49,90; $ 34.900). */
const CURRENCY_LOCALE: Record<string, string> = {
  BRL: 'pt-BR',
  ARS: 'es-AR',
  CLP: 'es-CL',
  COP: 'es-CO',
  PEN: 'es-PE',
  UYU: 'es-UY',
  MXN: 'es-MX',
  USD: 'es-EC',
};

function money(amount: number, currency: string | null): string {
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'pt-BR', { style: 'currency', currency })
      .format(amount)
      .replace(/\u00a0/g, ' ');
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Logo de emissora ou plataforma: a versão escura no tema escuro (acervo oficial), a clara no claro;
 * sem logo, as iniciais. Arquivos do nosso storage, fora do otimizador do Next.
 */
export function BrandLogo({
  name,
  logo,
  logoDark,
  size = 'md',
  title,
}: {
  name: string;
  logo: string | null;
  logoDark: string | null;
  size?: 'sm' | 'md';
  /** Crédito do arquivo (Commons), no tooltip do logo. */
  title?: string | undefined;
}) {
  const box = size === 'sm' ? 'h-6 w-10' : 'h-9 w-14';
  if (!logo && !logoDark)
    return (
      <span
        className={cn(
          box,
          'bg-muted text-muted-foreground inline-flex shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold',
        )}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  if (!logoDark || !logo || logoDark === logo)
    return (
      <img src={(logoDark ?? logo)!} alt="" title={title} className={cn(box, 'shrink-0 object-contain')} />
    );
  return (
    <span className={cn(box, 'inline-flex shrink-0')} title={title}>
      <img src={logo} alt="" className="size-full object-contain dark:hidden" />
      <img src={logoDark} alt="" className="hidden size-full object-contain dark:block" />
    </span>
  );
}

/** Logo com o nome embaixo (e o link da opção, quando há); tracejado quando é só detentor dos direitos. */
function LogoTile({ item, t, toConfirm }: { item: WatchLogo; t: T; toConfirm: boolean }) {
  const caption = [item.name, item.medium ? (t.medium[item.medium] ?? item.medium) : null]
    .filter(Boolean)
    .join(' · ');
  const body = (
    <>
      <BrandLogo name={item.name} logo={item.logo} logoDark={item.logoDark} />
      <span className="line-clamp-2 text-center text-xs leading-tight font-medium">{caption}</span>
      {item.regions.length ? (
        <span className="text-muted-foreground text-[10px] leading-tight">
          {fill(t.regions, { regions: item.regions.join(', ') })}
        </span>
      ) : null}
      {item.clientChannels.length ? (
        <span className="text-primary text-center text-[10px] leading-tight font-medium">
          {fill(t.clientChannels, { channels: item.clientChannels.join(', ') })}
        </span>
      ) : null}
    </>
  );
  const box = cn(
    'flex w-24 flex-col items-center gap-1.5 rounded-md border p-2',
    toConfirm && 'border-dashed',
  );
  return (
    <li>
      {item.href ? (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          aria-label={fill(t.open, { provider: item.name })}
          className={cn(box, 'hover:bg-muted transition-colors')}
        >
          {body}
        </a>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Logos pequenos com o nome no `title` (canais do plano e streamings inclusos). */
function MiniLogos({ items }: { items: AvailabilityLogo[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {items.map((c) => (
        <li key={c.id} title={c.name} className="flex items-center gap-1.5 rounded-sm border px-1.5 py-1">
          <BrandLogo name={c.name} logo={c.logo} logoDark={c.logo_dark} size="sm" />
          <span className="text-xs">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cartão de uma plataforma: logo, tipo e, por plano, os canais com o jogo e os streamings inclusos. */
function PlatformCard({ entry, mine, t }: { entry: PlatformAvailability; mine: boolean; t: T }) {
  const { platform, plans } = entry;
  return (
    <Item
      variant="outline"
      size="sm"
      className={cn(mine && 'border-primary/40 bg-primary/5')}
      data-testid="platform-card"
    >
      <ItemHeader className="justify-start gap-3">
        <ItemMedia>
          <BrandLogo
            name={platform.name}
            logo={platform.logo}
            logoDark={platform.logo_dark}
            title={platform.logo_credit?.text}
          />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{platform.name}</ItemTitle>
          <span className="text-muted-foreground text-xs">{t.kind[platform.kind] ?? platform.kind}</span>
        </ItemContent>
        {mine ? (
          <Badge variant="primary-light" className="ml-auto shrink-0">
            {t.yourOperator}
          </Badge>
        ) : null}
      </ItemHeader>
      {plans.length ? (
        <ul className="flex basis-full flex-col gap-2.5">
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-col gap-1.5 border-t pt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{plan.name}</span>
                <Badge variant={plan.access === 'included' ? 'success-light' : 'warning-light'} size="sm">
                  {plan.access === 'included' ? t.included : t.addon}
                </Badge>
              </div>
              {plan.via_channels.length ? <MiniLogos items={plan.via_channels} /> : null}
              {plan.included_services.length ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-[11px]">{t.includedServices}</span>
                  <MiniLogos items={plan.included_services} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : entry.addons?.length ? null : (
        <p className="text-muted-foreground basis-full border-t pt-2.5 text-xs">{t.notInYourOperator}</p>
      )}
      {entry.addons?.length ? (
        <div className="flex basis-full flex-col gap-1 border-t pt-2.5" data-testid="platform-addons">
          <span className="text-muted-foreground text-[11px]">{t.addonsAvailable}</span>
          <ul className="flex flex-col gap-0.5 text-xs">
            {entry.addons.map((a) => (
              <li key={`${a.id}|${a.channel ?? ''}`}>
                <span className="font-medium">{a.channel ?? a.name}</span>
                {a.price_from !== null ? (
                  <span className="text-muted-foreground">
                    {' · '}
                    {fill(t.priceFrom, { price: money(a.price_from, a.currency) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {platform.logo_credit?.attribution_required ? (
        // CC BY / CC BY-SA: o crédito do logo vai junto, visível
        <a
          href={platform.logo_credit.page_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground basis-full text-[10px] hover:underline"
        >
          {platform.logo_credit.text}
        </a>
      ) : null}
    </Item>
  );
}

/**
 * Onde assistir agrupado: TV aberta, canais pagos e "disponível também em" (um cartão por operadora ou
 * streaming). Sem plataforma, os cartões não aparecem; os outros grupos seguem.
 */
export function WhereToWatchGroups({ groups, t }: { groups: WatchGroups; t: T }) {
  const mineId = groups.yourOperator?.platform.id ?? null;
  // a operadora do tenant sem o jogo na grade entra como cartão próprio, com o aviso
  const cards =
    groups.yourOperator && !groups.platforms.some((p) => p.platform.id === mineId)
      ? [groups.yourOperator, ...groups.platforms]
      : groups.platforms;
  const alsoOn = cards.length + groups.others.length > 0;
  return (
    <div className="flex flex-col gap-4">
      {groups.toConfirm ? (
        <div
          className="bg-muted/50 flex items-start gap-2 rounded-md border border-dashed p-2.5"
          data-testid="channel-to-confirm"
        >
          <CircleDashed className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t.toConfirmTitle}</span>
            <span className="text-muted-foreground text-xs">{t.toConfirmHint}</span>
          </div>
        </div>
      ) : null}
      {groups.freeTv.length ? (
        <Group title={t.freeTv}>
          <ul className="flex flex-wrap gap-2">
            {groups.freeTv.map((c) => (
              <LogoTile key={c.key} item={c} t={t} toConfirm={groups.toConfirm} />
            ))}
          </ul>
        </Group>
      ) : null}
      {groups.payTv.length ? (
        <Group title={t.payTv}>
          <ul className="flex flex-wrap gap-2">
            {groups.payTv.map((c) => (
              <LogoTile key={c.key} item={c} t={t} toConfirm={groups.toConfirm} />
            ))}
          </ul>
        </Group>
      ) : null}
      {alsoOn ? (
        <Group title={t.alsoOn}>
          {cards.length ? (
            <div className="flex flex-col gap-2">
              {cards.map((entry) => (
                <PlatformCard
                  key={entry.platform.id}
                  entry={entry}
                  mine={entry.platform.id === mineId}
                  t={t}
                />
              ))}
            </div>
          ) : null}
          {groups.others.length ? (
            <ul className="flex flex-wrap gap-2">
              {groups.others.map((c) => (
                <LogoTile key={c.key} item={c} t={t} toConfirm={groups.toConfirm} />
              ))}
            </ul>
          ) : null}
        </Group>
      ) : null}
    </div>
  );
}
