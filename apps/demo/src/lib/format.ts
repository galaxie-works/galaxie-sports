/**
 * Iniciais de um nome (avatar, escudo sem imagem). Datas, números e rótulos no idioma escolhido ficam em
 * `lib/i18n` (`getFormatters`, `t.sport.*`).
 */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
