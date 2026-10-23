/**
 * Iniciais de um nome (avatar, escudo sem imagem). Datas, números e rótulos no idioma escolhido ficam em
 * `lib/i18n` (`getFormatters`, `t.sport.*`).
 */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    // pontuação no começo da palavra não vira inicial: "AFL (futebol australiano)" → "AF", não "A("
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
