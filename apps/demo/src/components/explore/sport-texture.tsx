import { cn } from '@/lib/utils';

/**
 * Textura de fundo dos cards de esporte: o desenho do campo, da quadra ou da pista em traço fino,
 * esmaecido para o canto. Puramente decorativa (aria-hidden), na cor do matiz do card.
 */

/** Vértices de um octógono regular (o cage do MMA). */
function octagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 8 }, (_, k) => {
    const a = ((22.5 + k * 45) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

/** Garrafão, arco de três e lance livre de um lado da quadra (espelhado com `flip`). */
function Key({ flip }: { flip?: boolean }) {
  return (
    <g transform={flip ? 'translate(240 0) scale(-1 1)' : undefined}>
      <rect x={10} y={52} width={46} height={46} />
      <circle cx={56} cy={75} r={14} />
      <path d="M10 22 H28 A56 56 0 0 1 28 128 H10" />
      <circle cx={20} cy={75} r={3} />
    </g>
  );
}

const DRAWINGS: Record<string, React.ReactNode> = {
  football: (
    <>
      <rect x={10} y={10} width={220} height={130} />
      <path d="M120 10 V140" />
      <circle cx={120} cy={75} r={20} />
      <rect x={10} y={40} width={32} height={70} />
      <rect x={10} y={58} width={12} height={34} />
      <rect x={198} y={40} width={32} height={70} />
      <rect x={218} y={58} width={12} height={34} />
      <path d="M42 62 A16 16 0 0 1 42 88 M198 62 A16 16 0 0 0 198 88" />
    </>
  ),
  basketball: (
    <>
      <rect x={10} y={10} width={220} height={130} />
      <path d="M120 10 V140" />
      <circle cx={120} cy={75} r={18} />
      <Key />
      <Key flip />
    </>
  ),
  volleyball: (
    <>
      <rect x={30} y={20} width={180} height={110} />
      <path d="M120 10 V140" strokeWidth={3} />
      <path d="M90 20 V130 M150 20 V130" />
      <path d="M20 10 V140 M220 10 V140" strokeDasharray="4 6" />
    </>
  ),
  'formula-1': (
    <>
      <path d="M30 110 C30 60 70 28 120 40 S200 26 212 70 S172 132 120 116 S30 142 30 110 Z" />
      <path d="M48 108 C48 72 80 48 120 58 S186 46 194 74 S164 116 120 102 S48 126 48 108 Z" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1].map((col) =>
          (row + col) % 2 === 0 ? (
            <rect
              key={`${row}-${col}`}
              x={31 + col * 8}
              y={92 + row * 6}
              width={8}
              height={6}
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </>
  ),
  mma: (
    <>
      <polygon points={octagon(120, 75, 64)} />
      <polygon points={octagon(120, 75, 46)} strokeDasharray="5 5" />
      <circle cx={120} cy={75} r={10} />
    </>
  ),
  'american-football': (
    <>
      <rect x={10} y={20} width={220} height={110} />
      <path d="M32 20 V130 M208 20 V130" strokeWidth={3} />
      <path d={Array.from({ length: 9 }, (_, i) => `M${50 + i * 17.5} 20 V130`).join(' ')} />
      <path
        d={Array.from({ length: 9 }, (_, i) => `M${50 + i * 17.5} 64 v6 M${50 + i * 17.5} 80 v6`).join(' ')}
      />
    </>
  ),
  baseball: (
    <>
      <path d="M120 136 L24 40 M120 136 L216 40" />
      <path d="M24 40 Q120 -18 216 40" />
      <polygon points="120,136 156,100 120,64 84,100" />
      <circle cx={120} cy={100} r={5} />
      <path d="M78 94 Q120 50 162 94" strokeDasharray="4 5" />
    </>
  ),
  hockey: (
    <>
      <rect x={10} y={15} width={220} height={120} rx={34} />
      <path d="M120 15 V135" strokeWidth={3} />
      <path d="M86 15 V135 M154 15 V135" />
      <circle cx={120} cy={75} r={14} />
      <circle cx={48} cy={46} r={12} />
      <circle cx={48} cy={104} r={12} />
      <circle cx={192} cy={46} r={12} />
      <circle cx={192} cy={104} r={12} />
      <path d="M24 65 A10 10 0 0 1 24 85 M216 65 A10 10 0 0 0 216 85" />
    </>
  ),
  handball: (
    <>
      <rect x={10} y={15} width={220} height={120} />
      <path d="M120 15 V135" />
      <path d="M10 32 Q58 32 58 75 Q58 118 10 118 M230 32 Q182 32 182 75 Q182 118 230 118" />
      <path
        d="M10 20 Q78 20 78 75 Q78 130 10 130 M230 20 Q162 20 162 75 Q162 130 230 130"
        strokeDasharray="5 5"
      />
    </>
  ),
  rugby: (
    <>
      <rect x={10} y={15} width={220} height={120} />
      <path d="M30 15 V135 M210 15 V135 M120 15 V135" />
      <path d="M64 15 V135 M176 15 V135" />
      <path d="M100 15 V135 M140 15 V135" strokeDasharray="4 6" />
      <path d="M30 62 V88 M30 75 H22 M210 62 V88 M210 75 H218" strokeWidth={2.5} />
    </>
  ),
  afl: (
    <>
      <ellipse cx={120} cy={75} rx={110} ry={62} />
      <rect x={95} y={50} width={50} height={50} />
      <circle cx={120} cy={75} r={15} />
      <circle cx={120} cy={75} r={4} />
      <path d="M50 27 Q86 75 50 123 M190 27 Q154 75 190 123" />
    </>
  ),
  multisport: (
    <>
      <rect x={10} y={15} width={220} height={120} rx={60} />
      <rect x={24} y={29} width={192} height={92} rx={46} />
      <rect x={38} y={43} width={164} height={64} rx={32} />
      <path d="M120 15 V43 M120 107 V135" />
    </>
  ),
};
DRAWINGS.nba = DRAWINGS.basketball;

export function SportTexture({ sport, className }: { sport: string; className?: string }) {
  const drawing = DRAWINGS[sport];
  if (!drawing) return null;
  return (
    <svg
      viewBox="0 0 240 150"
      aria-hidden
      focusable="false"
      className={cn(
        'pointer-events-none absolute right-0 bottom-0 h-auto opacity-[0.24] [mask-image:radial-gradient(120%_120%_at_100%_100%,black_35%,transparent_75%)] [&_*]:[vector-effect:non-scaling-stroke]',
        className,
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawing}
    </svg>
  );
}
