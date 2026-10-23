import { LanguageSelect } from '@/components/app-shell/language-select';
import { buttonVariants } from '@/components/ui/button';
import { StarfieldBackground } from '@/components/ui/starfield';
import { getT } from '@/lib/i18n/server';
import { LOGO_PATH } from '@/lib/site';

/**
 * Moldura das páginas públicas (apresentação, termos e privacidade): o mesmo céu estrelado e o logo do
 * login, com cabeçalho e rodapé. Links comuns (`<a>`), não `<Link>`: a raiz muda de página quando a
 * pessoa entra, e a navegação completa não deixa a apresentação no cache do roteador.
 */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const t = (await getT()).site;
  return (
    <div className="flex min-h-svh flex-col">
      <StarfieldBackground count={260} speed={0.15} />
      {/* brilho de fundo sutil, por cima das estrelas */}
      <div className="bg-foreground/[0.04] pointer-events-none fixed -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full blur-[120px]" />

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <a href="/" aria-label={t.nav.home} className="shrink-0">
          <img src={LOGO_PATH} alt={t.nav.logoAlt} draggable={false} className="h-8 w-auto object-contain" />
        </a>
        <a href="/login" className={buttonVariants({ size: 'lg' })}>
          {t.nav.signIn}
        </a>
      </header>

      <main className="relative mx-auto w-full max-w-5xl flex-1 px-6">{children}</main>

      <footer className="text-muted-foreground relative mx-auto mt-16 flex w-full max-w-5xl flex-col gap-4 border-t px-6 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>{t.footer.product}</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/sobre" className="hover:text-foreground">
              {t.nav.about}
            </a>
            <a href="/termos" className="hover:text-foreground">
              {t.nav.terms}
            </a>
            <a href="/privacidade" className="hover:text-foreground">
              {t.nav.privacy}
            </a>
          </nav>
          <LanguageSelect className="h-9" />
        </div>
      </footer>
    </div>
  );
}
