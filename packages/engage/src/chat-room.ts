/**
 * Sala do Jogo do Chat ao vivo (#915, #959), sem banco nem HTTP: o estado efetivo da sala e quem pode enviar.
 *
 * O estado guardado (`open`, `frozen`, `read_only_peak`) é o que a equipe ou o sistema decidiu; a janela vem do jogo:
 * a sala abre `openBeforeMinutes` antes do início e fecha `closeAfterMinutes` depois do fim. Fora da janela, vale o
 * horário: antes, `scheduled` (ninguém lê nem escreve ainda); depois, `closed` (só leitura do que ficou).
 */

export type ChatRoomState = 'scheduled' | 'open' | 'frozen' | 'read_only_peak' | 'closed';

/** Status do jogo que encerram a partida (o resto conta como "ainda pode acontecer"). */
const FINISHED = new Set(['finished', 'cancelled', 'abandoned']);
/** Status em que o jogo não vai acontecer na data: a sala não abre. */
const OFF = new Set(['postponed', 'cancelled', 'abandoned']);

export interface ChatRoomWindowInput {
  storedState: 'open' | 'frozen' | 'read_only_peak';
  event: {
    startsAt: number;
    /** Fim previsto (ms). */
    endsAtExpected: number;
    /** Status do jogo (`core.event.status`). */
    status: string;
    /** Última mudança do jogo (ms), usada como fim real quando ele já terminou. */
    updatedAt?: number | null;
  };
  openBeforeMinutes: number;
  closeAfterMinutes: number;
  now: number;
}

export interface ChatRoomWindow {
  state: ChatRoomState;
  opensAt: number;
  closesAt: number;
}

const MIN = 60_000;
/** Teto do fim real de um jogo terminado (o `updated_at` muda depois, com o espelho). */
const MAX_GAME_MS = 6 * 3600_000;

/** Estado efetivo e janela da sala. */
export function roomWindow(input: ChatRoomWindowInput): ChatRoomWindow {
  const { event } = input;
  const opensAt = event.startsAt - input.openBeforeMinutes * MIN;
  const margin = input.closeAfterMinutes * MIN;
  const expectedEnd = Math.max(event.endsAtExpected, event.startsAt);
  let closesAt: number;
  if (FINISHED.has(event.status)) {
    // terminou: o fim real é a última mudança do jogo (o apito), com teto de segurança (o espelho mexe depois)
    const whistle = event.updatedAt ?? expectedEnd;
    closesAt = Math.min(Math.max(whistle, event.startsAt), event.startsAt + MAX_GAME_MS) + margin;
  } else {
    // ainda não terminou (atraso, prorrogação, pênaltis, paralisação): a sala não fecha no meio do jogo. Teto: jogo
    // que o fornecedor esqueceu de encerrar fecha 6 h depois do início
    closesAt = Math.max(expectedEnd, Math.min(input.now, event.startsAt + MAX_GAME_MS)) + margin;
  }
  let state: ChatRoomState;
  if (OFF.has(event.status) && input.now >= opensAt) state = 'closed';
  else if (input.now >= closesAt) state = 'closed';
  else if (input.now < opensAt) state = 'scheduled';
  else state = input.storedState;
  return { state, opensAt, closesAt };
}

/** Por que o envio foi recusado (o widget mostra o aviso e esconde a caixa de texto). */
export type ChatSendRefusal =
  'room_scheduled' | 'room_frozen' | 'room_closed' | 'room_read_only_peak' | 'age_band';

/**
 * Pode enviar? Só `18plus` escreve (D1); `13_17` lê e reage; `under13` não entra. Sala congelada, encerrada, ainda
 * fechada ou só leitura por pico (D6) recusa todo mundo.
 */
export function sendRefusal(state: ChatRoomState, ageBand: string): ChatSendRefusal | null {
  if (ageBand !== '18plus') return 'age_band';
  switch (state) {
    case 'open':
      return null;
    case 'frozen':
      return 'room_frozen';
    case 'closed':
      return 'room_closed';
    case 'scheduled':
      return 'room_scheduled';
    case 'read_only_peak':
      return 'room_read_only_peak';
  }
}

/** Faixa que lê a sala (menor de 13 não entra em recurso social nenhum). */
export const canReadRoom = (ageBand: string | null): boolean => ageBand !== 'under13';

const NOTICES: Record<'pt' | 'es' | 'en', Record<ChatSendRefusal, string>> = {
  pt: {
    age_band: 'Só maiores de 18 anos escrevem no chat. Você pode ler e reagir.',
    room_scheduled: 'A sala ainda não abriu. Ela abre antes do início do jogo.',
    room_frozen: 'A sala está congelada pela moderação. Você pode continuar lendo.',
    room_closed: 'A sala foi encerrada. As mensagens ficam para leitura.',
    room_read_only_peak: 'A sala está cheia e ficou só leitura para quem entrou agora.',
  },
  es: {
    age_band: 'Solo los mayores de 18 años escriben en el chat. Puedes leer y reaccionar.',
    room_scheduled: 'La sala todavía no abrió. Abre antes del inicio del partido.',
    room_frozen: 'La moderación congeló la sala. Puedes seguir leyendo.',
    room_closed: 'La sala cerró. Los mensajes quedan para lectura.',
    room_read_only_peak: 'La sala está llena y quedó solo de lectura para quienes acaban de entrar.',
  },
  en: {
    age_band: 'Only people aged 18 or over can write in the chat. You can read and react.',
    room_scheduled: 'The room is not open yet. It opens before kickoff.',
    room_frozen: 'Moderators froze the room. You can keep reading.',
    room_closed: 'The room is closed. Messages stay available to read.',
    room_read_only_peak: 'The room is full and became read-only for people who just joined.',
  },
};

/** Aviso ao torcedor no idioma dele (`pt-BR`, `es-AR`, `en`…); português quando o idioma não tem texto. */
export function sendRefusalNotice(refusal: ChatSendRefusal, locale?: string): string {
  const l = locale?.slice(0, 2).toLowerCase();
  return NOTICES[l === 'es' || l === 'en' ? l : 'pt'][refusal];
}
