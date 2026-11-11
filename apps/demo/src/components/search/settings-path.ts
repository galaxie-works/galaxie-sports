/** Rota de Ajustes (o caminho do navegador vem sem o idioma). Leve: a paleta usa sem carregar a busca de ajustes. */
export const isSettingsPath = (pathname: string | null) =>
  !!pathname && (pathname === '/ajustes' || pathname.startsWith('/ajustes/'));
