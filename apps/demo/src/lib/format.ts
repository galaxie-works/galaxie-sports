const TZ = 'America/Sao_Paulo';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateLong = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});
const time = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtDateLong = (iso: string) => dateLong.format(new Date(iso));
export const fmtTime = (iso: string) => time.format(new Date(iso));
export const fmtShortDate = (iso: string) => dayMonth.format(new Date(iso));

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  starting: 'Começando',
  live: 'Ao vivo',
  break: 'Intervalo',
  finished: 'Encerrado',
  postponed: 'Adiado',
  cancelled: 'Cancelado',
  suspended: 'Suspenso',
  abandoned: 'Abandonado',
};

export const POSITION_LABEL: Record<string, string> = {
  Goalkeeper: 'Goleiros',
  Defender: 'Defensores',
  Midfielder: 'Meio-campistas',
  Attacker: 'Atacantes',
};

export const COMPETITION_TYPE_LABEL: Record<string, string> = {
  league: 'Liga',
  cup: 'Copa',
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
