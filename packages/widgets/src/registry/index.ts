// Entrada `@galaxie/widgets/registry`: só o gerador do item de registry (sem React), para rotas de servidor.
export {
  PUBLISHABLE_KEY_ENV,
  REGISTRY_CORE_NAME,
  REGISTRY_ITEM_SCHEMA_URL,
  buildRegistryItem,
  toRegistryName,
  type BuildRegistryItemInput,
  type RegistryItem,
  type RegistryItemFile,
} from './build-registry-item.js';
export { CORE_VERSION } from './sources.generated.js';
// validação das opções da tabela (sem React), para o Builder conferir o que chega do navegador
export { parseStandingsOptions, type StandingsOptions } from '../core/model.js';
export { parseLiveListOptions, type LiveListOptions } from '../core/model.js';
// opções de conteúdo de cada widget (sem React), para o Builder e as rotas /e e /r
export { WIDGET_OPTIONS, optionProps, parseWidgetOptions, type WidgetOptions } from '../options.js';
