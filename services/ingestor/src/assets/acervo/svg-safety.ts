/**
 * SVG de pacote é entrada não confiável e vai ser servido pelo nosso CDN: quem abrir a URL direto no
 * navegador executa o que o arquivo tiver. Só passa SVG estático — sem script, sem handler de evento,
 * sem `javascript:`, sem `<foreignObject>` (HTML embutido) e sem referência externa por `href`.
 * O que não passa fica de fora e o logo cai no PNG do pacote, quando houver.
 */
const ACTIVE = [
  /<script\b/i,
  /<foreignObject\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<!ENTITY/i,
  /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:text\/html)/i,
  /@import/i,
];

/** Motivo da recusa, ou null quando o SVG é estático. */
export function unsafeSvgReason(body: Uint8Array | string): string | null {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  if (!/<svg\b/i.test(text)) return 'não é SVG';
  const hit = ACTIVE.find((re) => re.test(text));
  return hit ? `conteúdo ativo (${hit.source})` : null;
}
