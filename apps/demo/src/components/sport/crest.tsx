import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/format';

const SIZES = { xs: 'size-5', sm: 'size-7', md: 'size-10', lg: 'size-16', xl: 'size-24' } as const;

/** Escudo, logo de competição, bandeira ou foto, com as iniciais como reserva. */
export function Crest({
  src,
  name,
  size = 'sm',
  round = false,
}: {
  src: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  /** Fotos de pessoas ficam redondas; escudos e logos mantêm o formato original. */
  round?: boolean;
}) {
  const shape = round ? '' : 'rounded-none after:hidden';
  return (
    <Avatar className={`${SIZES[size]} ${shape}`}>
      {src ? (
        <AvatarImage
          src={src}
          alt={name}
          className={round ? 'object-cover' : 'rounded-none object-contain'}
        />
      ) : null}
      <AvatarFallback className={round ? '' : 'rounded-md'}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
