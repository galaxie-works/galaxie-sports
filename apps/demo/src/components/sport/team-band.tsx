import type { TeamColors } from '@galaxie/contracts';

/**
 * Faixa no topo da página com o gradiente sugerido do time (API `colors.gradient`), esmaecendo para o
 * fundo escuro. Fica atrás do hero (o contêiner tem `isolate`); um véu escuro mantém o texto legível.
 * `children` entra por cima do gradiente, recortado pela faixa (ex.: o número da camisa no perfil).
 */
export function TeamBand({ colors, children }: { colors: TeamColors; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to bottom, #000 35%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 35%, transparent)',
      }}
    >
      <div className="absolute inset-0" style={{ background: colors.gradient }} />
      <div className="absolute inset-0 bg-black/25" />
      {children}
    </div>
  );
}
