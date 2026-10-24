/**
 * Lista de canais do cliente no banco (só no servidor), pelas funções de `@galaxie/db/channel-lists`.
 * O portal passa por aqui (os testes trocam este módulo), como a grade passa por `lib/lineup/store.ts`.
 */
export {
  confirmChannelList,
  deleteChannelList,
  getChannelList,
  saveChannelList,
  setChannelListOverrides,
  type TenantChannelList,
} from '@galaxie/db/channel-lists';

export { builderDb as channelListDb } from '@/lib/builder/store';
