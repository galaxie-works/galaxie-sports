'use client';

import { useMemo } from 'react';

import { LanguageOption } from '@/components/app-shell/language-select';
import { Badge } from '@/components/reui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserStatus } from '@/lib/auth/admin';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { LANGUAGES, isLocale, type Locale } from '@/lib/i18n/config';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<
  UserStatus,
  'success-light' | 'warning-light' | 'destructive-light' | 'secondary'
> = {
  active: 'success-light',
  pending: 'warning-light',
  expired: 'destructive-light',
  disabled: 'secondary',
};

export function StatusBadge({ status }: { status: UserStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[status]} radius="full">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.admin.status[status]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: 'admin' | 'user' }) {
  const { t } = useI18n();
  return role === 'admin' ? (
    <Badge variant="primary-light">{t.admin.roles.admin}</Badge>
  ) : (
    <Badge variant="outline">{t.admin.roles.user}</Badge>
  );
}

/** Escolha do idioma de uma pessoa (convite e perfil). `value` nulo mostra `placeholder`. */
export function LocaleSelect({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: Locale | null;
  onChange: (next: Locale) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select items={LANGUAGES} value={value} onValueChange={(v) => isLocale(v) && onChange(v)}>
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <SelectValue>
          {(v: Locale | null) =>
            v ? <LanguageOption value={v} /> : <span className="text-muted-foreground">{placeholder}</span>
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {LANGUAGES.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              <LanguageOption value={l.value} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const isLocalIp = (ip: string) =>
  /^[0:]+$/.test(ip) || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';

const browserOf = (ua: string) =>
  /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;

const osOf = (ua: string) =>
  /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;

/**
 * Datas, validade, IP e dispositivo no idioma da tela e no fuso de quem vê. O fuso vem do servidor
 * (prop), para o HTML do servidor e o da hidratação baterem.
 */
export function useAdminFormat(timeZone: string) {
  const { locale, t } = useI18n();
  const f = useFormatters(timeZone);
  return useMemo(() => {
    const none = t.common.none;
    const formatDate = (iso: string | null | undefined) => (iso ? f.date(iso) : none);
    return {
      locale,
      /** "há 3 horas", "em 5 dias", "agora". */
      relativeTime: (iso: string | null | undefined) => (iso ? f.relative(iso) : none),
      formatDate,
      formatDateTime: (iso: string | null | undefined) => (iso ? f.dayTime(iso) : none),
      /** Validade do acesso em texto curto. */
      accessLabel: (role: 'admin' | 'user', expiresAt: string | null) => {
        if (role === 'admin' || !expiresAt) return t.admin.access.noLimit;
        const template =
          new Date(expiresAt).getTime() < Date.now() ? t.admin.access.expiredOn : t.admin.access.until;
        return fill(template, { date: formatDate(expiresAt) });
      },
      /** IP legível; loopback e o endereço "zerado" que o Node dá para conexões locais viram "rede local". */
      formatIp: (ip: string | null | undefined) => {
        if (!ip) return null;
        return isLocalIp(ip) ? t.admin.device.localNetwork : ip;
      },
      /** Navegador e sistema a partir do user agent (para a lista de sessões). */
      describeAgent: (ua: string | null | undefined) => {
        if (!ua) return t.admin.device.unknownDevice;
        return fill(t.admin.device.agent, {
          browser: browserOf(ua) ?? t.admin.device.browser,
          os: osOf(ua) ?? t.admin.device.otherOs,
        });
      },
    };
  }, [locale, t, f]);
}
