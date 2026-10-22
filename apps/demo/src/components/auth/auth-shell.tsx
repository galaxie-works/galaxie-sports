'use client';

import { StarsBackground } from '@/components/animate-ui/components/backgrounds/stars';
import SoftBlurIn from '@/components/smoothui/soft-blur-in';

/**
 * Moldura das telas de acesso (login, definir e redefinir senha), igual ao login do app desktop da
 * Galaxie: céu estrelado com gradiente radial, brilho sutil, marca com entrada suave e título/subtítulo
 * revelados letra a letra. A demo é só tema escuro, então usa a variante escura do logo e das estrelas.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-svh place-items-center overflow-hidden px-6">
      <StarsBackground
        starColor="#FFF"
        className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_120%_70%_at_50%_100%,_#262626_0%,_#000_100%)]"
      />
      {/* brilho de fundo sutil, por cima das estrelas */}
      <div className="bg-foreground/[0.04] pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full blur-[120px]" />

      <div className="relative w-full max-w-[400px] animate-[fade-in_0.4s_ease]">
        <div className="flex flex-col items-center text-center">
          {/* Logo da marca, servido de /public (não passa pelo otimizador). */}
          <img
            src="/brand/galaxie_logo_dark.png"
            alt="Galaxie Works"
            draggable={false}
            className="logo-in mb-5 h-12 w-auto object-contain"
          />
          <SoftBlurIn className="text-2xl font-semibold tracking-tight" delay={140} stagger={16}>
            {title}
          </SoftBlurIn>
          <SoftBlurIn className="text-muted-foreground mt-1.5 text-[15px]" delay={320} stagger={14}>
            {subtitle}
          </SoftBlurIn>
        </div>
        <div className="mt-9">{children}</div>
      </div>

      <p className="text-muted-foreground absolute bottom-6 left-1/2 -translate-x-1/2 text-xs">
        Acesso por convite · Galaxie Works
      </p>
    </div>
  );
}
