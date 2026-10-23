import { fill } from '@/lib/i18n/text';

/** "até {date} · fonte: {source}", com as fontes como links pelo domínio (pt.wikipedia.org, ogol.com.br). */
export function SourceNote({ template, date, urls }: { template: string; date: string; urls: string[] }) {
  const [before, after = ''] = fill(template, { date }).split('{source}');
  const links = urls.map((url, i) => {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // URL validada na base; se vier quebrada, mostra como está
    }
    return (
      <span key={url}>
        {i ? ', ' : null}
        <a href={url} target="_blank" rel="noreferrer" className="hover:text-foreground underline">
          {host}
        </a>
      </span>
    );
  });
  return (
    <>
      {before}
      {links}
      {after}
    </>
  );
}
