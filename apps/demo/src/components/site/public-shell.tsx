import { LanguageSelect } from '@/components/app-shell/language-select';
import { buttonVariants } from '@/components/ui/button';
import { StarfieldBackground } from '@/components/ui/starfield';
import { getT } from '@/lib/i18n/server';
import { CONTACT_EMAIL, LOGO_PATH, STATUS_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

/** Seções da apresentação, na ordem do menu. */
const SECTIONS = ['features', 'sports', 'markets', 'access'] as const;
const SECTION_IDS: Record<(typeof SECTIONS)[number], string> = {
  features: 'recursos',
  sports: 'esportes',
  markets: 'mercados',
  access: 'acesso',
};

/**
 * Moldura das páginas públicas (apresentação, termos e privacidade): o céu estrelado do login, um
 * cabeçalho em pílula que acompanha a rolagem e o rodapé com os links legais, o status e o idioma. Links comuns
 * (`<a>`), não `<Link>`: a raiz muda de página quando a pessoa entra, e a navegação completa não deixa a
 * apresentação no cache do roteador. `onLanding`: as âncoras do menu apontam para a própria página.
 */
export async function PublicShell({
  children,
  onLanding = false,
}: {
  children: React.ReactNode;
  onLanding?: boolean;
}) {
  const t = (await getT()).site;
  const anchor = (id: string) => `${onLanding ? '' : '/sobre'}#${id}`;
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t.nav.skip}
      </a>
      {/* com "reduzir movimento", só o fundo, sem as estrelas em movimento */}
      <StarfieldBackground count={260} speed={0.15} className="motion-reduce:[&_canvas]:hidden" />
      {/* brilhos de fundo, por cima das estrelas */}
      <div className="bg-primary/[0.12] pointer-events-none fixed -top-48 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full blur-[140px]" />

      <header className="sticky top-3 z-40 mx-auto mt-3 w-full max-w-6xl px-4 sm:px-6">
        <div className="bg-background/70 flex items-center justify-between gap-4 rounded-full border py-2 pr-2 pl-5 shadow-lg shadow-black/20 backdrop-blur-md">
          <a href={onLanding ? '#conteudo' : '/'} aria-label={t.nav.home} className="shrink-0 rounded-sm">
            <img
              src={LOGO_PATH}
              alt={t.nav.logoAlt}
              width={110}
              height={30}
              draggable={false}
              className="h-7 w-auto object-contain"
            />
          </a>
          <nav aria-label={t.nav.menu} className="hidden items-center gap-1 md:flex">
            {SECTIONS.map((key) => (
              <a
                key={key}
                href={anchor(SECTION_IDS[key])}
                className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring rounded-full px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2"
              >
                {t.nav[key]}
              </a>
            ))}
          </nav>
          <a href="/login" className={cn(buttonVariants({ size: 'lg' }), 'rounded-full px-5')}>
            {t.nav.signIn}
          </a>
        </div>
      </header>

      <main id="conteudo" className="relative mx-auto w-full max-w-6xl flex-1 scroll-mt-24 px-4 sm:px-6">
        {children}
      </main>

      <footer className="relative mx-auto mt-24 w-full max-w-6xl px-4 sm:px-6">
        <div className="text-muted-foreground flex flex-col gap-6 border-t py-10 text-sm md:flex-row md:items-start md:justify-between">
          <div className="flex max-w-sm flex-col gap-3">
            <img
              src={LOGO_PATH}
              alt={t.nav.logoAlt}
              width={92}
              height={25}
              loading="lazy"
              className="h-6 w-auto self-start object-contain"
            />
            <p>{t.footer.product}</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="hover:text-foreground self-start underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
          <div className="flex flex-col gap-4 md:items-end">
            <nav aria-label={t.nav.legal} className="flex flex-wrap gap-x-5 gap-y-2">
              <a href={onLanding ? '#conteudo' : '/sobre'} className="hover:text-foreground">
                {t.nav.about}
              </a>
              <a href="/termos" className="hover:text-foreground">
                {t.nav.terms}
              </a>
              <a href="/privacidade" className="hover:text-foreground">
                {t.nav.privacy}
              </a>
              <a href={STATUS_URL} className="hover:text-foreground">
                {t.nav.status}
              </a>
            </nav>
            <LanguageSelect className="h-9" />
          </div>
        </div>
      </footer>
    </div>
  );
}
