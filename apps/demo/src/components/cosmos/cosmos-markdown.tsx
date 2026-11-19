/**
 * Markdown simples das respostas da Cosmos (#1411): parágrafos, títulos, listas, negrito, itálico, código em linha e
 * links. Monta elementos React (nada de HTML cru): texto do modelo nunca vira marcação. Link só para rota do próprio
 * painel (começa com `/`) ou https; o resto fica como texto. Os blocos de código continuam com o `CodeBlock` de quem
 * chama (`markdownFences`).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export type MdBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Separa o texto em blocos: título, lista (numerada ou não) e parágrafo. */
export function parseMarkdownBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n') });
    para = [];
  };
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[1]!.trim() });
    } else if (item) {
      flush();
      const ordered = !bullet;
      const last = blocks.at(-1);
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(item[1]!.trim());
      else blocks.push({ type: 'list', ordered, items: [item[1]!.trim()] });
    } else {
      const last = blocks.at(-1);
      // linha recuada logo depois de um item continua o item
      if (!para.length && last?.type === 'list' && /^\s{2,}\S/.test(line))
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      else para.push(line);
    }
  }
  flush();
  return blocks;
}

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

const INLINE = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*)/g;

/** Link aceito: rota do painel (`/…`, sem `//`) ou https. */
export const safeHref = (href: string): string | null =>
  (href.startsWith('/') && !href.startsWith('//')) || /^https:\/\/[^\s]+$/i.test(href) ? href : null;

/** Pedaços de uma linha: texto, negrito, itálico, código e link. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) out.push({ type: 'text', text: text.slice(at, m.index) });
    if (m[2] ?? m[3]) out.push({ type: 'strong', text: (m[2] ?? m[3])! });
    else if (m[4]) out.push({ type: 'code', text: m[4] });
    else if (m[5]) {
      const href = safeHref(m[6]!);
      out.push(href ? { type: 'link', text: m[5], href } : { type: 'text', text: m[5] });
    } else out.push({ type: 'em', text: m[7]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}

function Inline({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <>
      {parseInline(text).map((p, i): ReactNode => {
        switch (p.type) {
          case 'strong':
            return (
              <strong key={i} className="font-semibold">
                {p.text}
              </strong>
            );
          case 'em':
            return <em key={i}>{p.text}</em>;
          case 'code':
            return (
              <code key={i} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
                {p.text}
              </code>
            );
          case 'link':
            return p.href.startsWith('/') ? (
              <Link
                key={i}
                href={p.href}
                onClick={onNavigate}
                className="text-primary underline underline-offset-2"
              >
                {p.text}
              </Link>
            ) : (
              <a
                key={i}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {p.text}
              </a>
            );
          default:
            return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}

/** Um trecho de texto da resposta (fora dos blocos de código), formatado. */
export function CosmosMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      {parseMarkdownBlocks(text).map((b, i) => {
        if (b.type === 'heading')
          return (
            <p key={i} className="font-semibold">
              <Inline text={b.text} onNavigate={onNavigate} />
            </p>
          );
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={b.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} onNavigate={onNavigate} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline text={b.text} onNavigate={onNavigate} />
          </p>
        );
      })}
    </div>
  );
}
