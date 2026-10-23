'use client';

import { LanguageSelect } from '@/components/app-shell/language-select';
import SoftBlurIn from '@/components/smoothui/soft-blur-in';
import { StarfieldBackground } from '@/components/ui/starfield';
import { useI18n } from '@/lib/i18n/client';

/**
 * Moldura das telas de acesso (login, definir e redefinir senha), igual ao login do app desktop da
 * Galaxie: campo de estrelas em movimento (viagem pelo espaço), brilho sutil, marca com entrada suave e título/subtítulo
 * revelados letra a letra. A demo é só tema escuro, então usa a variante escura do logo e das estrelas.
 * No rodapé, como no app desktop, o seletor de idioma (a escolha vale para o app todo) e os links dos
 * termos de uso e da privacidade.
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
  const { t } = useI18n();
  return (
    <div className="relative flex min-h-svh flex-col items-center overflow-hidden px-6">
      <StarfieldBackground className="absolute inset-0" count={500} speed={0.4} />
      {/* brilho de fundo sutil, por cima das estrelas */}
      <div className="bg-foreground/[0.04] pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full blur-[120px]" />

      <div className="relative my-auto w-full max-w-[400px] animate-[fade-in_0.4s_ease] pt-12 pb-8">
        <div className="flex flex-col items-center text-center">
          {/* Logo da marca, servido de /public (não passa pelo otimizador). */}
          <img
            src="/brand/galaxie_logo_dark.png"
            alt={t.auth.shell.logoAlt}
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

      <div className="relative flex flex-col items-center gap-3 pb-6">
        <LanguageSelect className="h-9" />
        <p className="text-muted-foreground text-xs whitespace-nowrap">{t.auth.shell.footer}</p>
        <nav className="text-muted-foreground flex gap-4 text-xs">
          <a href="/termos" className="hover:text-foreground underline-offset-4 hover:underline">
            {t.auth.about.terms}
          </a>
          <a href="/privacidade" className="hover:text-foreground underline-offset-4 hover:underline">
            {t.auth.about.privacy}
          </a>
        </nav>
      </div>
    </div>
  );
}
