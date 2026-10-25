import { PublicShell } from '@/components/site/public-shell';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getT } from '@/lib/i18n/server';
import { rich } from '@/lib/i18n/text';
import { CONTACT_EMAIL } from '@/lib/site';

type LegalDoc = Dictionary['site']['legal']['terms'] | Dictionary['site']['legal']['privacy'];

const external = (href: string) => (chunk: string) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-foreground underline underline-offset-4"
  >
    {chunk}
  </a>
);

/** Links exigidos pelas políticas dos serviços de API do YouTube (termos do YouTube e privacidade do Google). */
const LINKS = {
  ytterms: external('https://www.youtube.com/t/terms'),
  gprivacy: external('https://policies.google.com/privacy'),
};

const mail = (chunk: string) => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-4">
    {chunk}
  </a>
);

/** Texto legal curto (termos de uso, privacidade): título, data da versão, introdução e seções. */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = (await getT()).site.legal;
  return (
    <PublicShell>
      <article className="max-w-3xl py-12 sm:py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{doc.title}</h1>
        <p className="text-muted-foreground mt-3 text-sm">{t.updated}</p>
        <p className="text-muted-foreground mt-6 text-lg leading-relaxed">{doc.intro}</p>
        {Object.entries(doc.sections).map(([key, section]) => (
          <section key={key} className="mt-9">
            <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              {rich(section.body, { email: mail, ...LINKS }, { email: CONTACT_EMAIL })}
            </p>
          </section>
        ))}
        <p className="mt-12 text-sm">
          <a
            href="/sobre"
            className="text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            {t.back}
          </a>
        </p>
      </article>
    </PublicShell>
  );
}
