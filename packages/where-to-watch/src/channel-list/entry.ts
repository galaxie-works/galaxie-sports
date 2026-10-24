/**
 * Entrada `@galaxie/where-to-watch/channel-list`: o casamento da lista de canais e o carregador do
 * dicionário, sem as partes do pacote que falam com o banco (o portal da demo importa daqui).
 */
export * from './index.js';
export { WtwConfig } from '../config/directory.js';
export { loadWtwConfig, type LoadWtwConfigOptions } from '../config/loader.js';
export { WTW_COUNTRIES, type WtwCountry } from '../config/types.js';
