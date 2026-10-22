import { Badge } from '@/components/reui/badge';
import type { UserStatus } from '@/lib/auth/admin';

const STATUS: Record<
  UserStatus,
  { label: string; variant: 'success-light' | 'warning-light' | 'destructive-light' | 'secondary' }
> = {
  active: { label: 'Ativo', variant: 'success-light' },
  pending: { label: 'Convite pendente', variant: 'warning-light' },
  expired: { label: 'Expirado', variant: 'destructive-light' },
  disabled: { label: 'Desativado', variant: 'secondary' },
};

export function StatusBadge({ status }: { status: UserStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} radius="full">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: 'admin' | 'user' }) {
  return role === 'admin' ? (
    <Badge variant="primary-light">Admin</Badge>
  ) : (
    <Badge variant="outline">Convidado</Badge>
  );
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "há 3 horas", "em 5 dias", "agora". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'agora';
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFmt.format(new Date(iso)) : '—';

/** Validade do acesso em texto curto. */
export function accessLabel(role: 'admin' | 'user', expiresAt: string | null) {
  if (role === 'admin' || !expiresAt) return 'Sem prazo';
  return `${new Date(expiresAt).getTime() < Date.now() ? 'Venceu' : 'Até'} ${formatDate(expiresAt)}`;
}

/** IP legível; loopback e o endereço "zerado" que o Node dá para conexões locais viram "rede local". */
export function formatIp(ip: string | null | undefined) {
  if (!ip) return null;
  if (/^[0:]+$/.test(ip) || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1')
    return 'rede local';
  return ip;
}

/** Navegador e sistema a partir do user agent (para a lista de sessões). */
export function describeAgent(ua: string | null | undefined) {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'outro sistema';
  return `${browser} no ${os}`;
}
