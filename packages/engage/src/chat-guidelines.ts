/**
 * Diretrizes da comunidade do Chat ao vivo (#957): o texto que o Torcedor aceita antes da primeira mensagem (item 6.2
 * do Contrato base). Vêm do modelo do Anexo do Chat (repo interna, `juridico/anexo-chat.pt-BR.md`, item 6), em
 * linguagem de leigo. Mudou o texto de um jeito que muda a regra: sobe a versão, e todo mundo aceita de novo.
 *
 * Minuta: o texto final depende da revisão do advogado.
 */
export const CHAT_GUIDELINES_VERSION = 1;

export interface ChatGuidelines {
  version: number;
  title: string;
  intro: string;
  /** "Aqui não pode:" */
  notAllowedTitle: string;
  notAllowed: string[];
  whoWrites: string;
  consequences: string;
  report: string;
  accept: string;
}

type Locale = 'pt' | 'es' | 'en';

const TEXT: Record<Locale, Omit<ChatGuidelines, 'version'>> = {
  pt: {
    title: 'Como funciona o chat',
    intro: 'O chat é para torcer junto. Zoar o rival faz parte. Ofender pessoas, não.',
    notAllowedTitle: 'Aqui não pode:',
    notAllowed: [
      'ofender alguém pela cor, origem, religião, gênero, orientação sexual, deficiência ou qualquer outra característica',
      'ameaçar, perseguir ou humilhar outra pessoa',
      'conteúdo sexual',
      'passar telefone, e-mail, endereço ou documento, seu ou de outra pessoa',
      'passar perfil de rede social ou chamar alguém para conversar em outro app',
      'links fora dos sites liberados',
      'apostas, odds ou propaganda de casa de aposta',
      'combinar resultado de jogo ou vender ingresso',
      'mandar mensagem demais, repetir a mesma mensagem ou usar robô',
    ],
    whoWrites:
      'Só maiores de 18 anos escrevem. De 13 a 17 anos você lê e reage. Menores de 13 anos não entram.',
    consequences:
      'Se você quebrar uma regra, a mensagem pode ser barrada ou tirada do ar, e você pode ficar sem escrever por um tempo, ser suspenso ou banido. Você pode ver as punições e pedir revisão pelo seu Perfil.',
    report:
      'Viu algo errado? Toque em "Denunciar" na mensagem. Racismo, ameaça e qualquer coisa envolvendo crianças são tratados primeiro.',
    accept: 'Li e aceito',
  },
  es: {
    title: 'Cómo funciona el chat',
    intro:
      'El chat es para alentar juntos. Burlarse del rival es parte del juego. Ofender a las personas, no.',
    notAllowedTitle: 'Aquí no se permite:',
    notAllowed: [
      'ofender a alguien por su color, origen, religión, género, orientación sexual, discapacidad o cualquier otra característica',
      'amenazar, acosar o humillar a otra persona',
      'contenido sexual',
      'compartir teléfono, correo, dirección o documento, tuyos o de otra persona',
      'compartir perfiles de redes sociales o invitar a hablar por otra app',
      'enlaces fuera de los sitios permitidos',
      'apuestas, cuotas o publicidad de casas de apuestas',
      'arreglar resultados o revender entradas',
      'enviar demasiados mensajes, repetir el mismo mensaje o usar bots',
    ],
    whoWrites:
      'Solo los mayores de 18 años escriben. De 13 a 17 años puedes leer y reaccionar. Los menores de 13 años no entran.',
    consequences:
      'Si rompes una regla, el mensaje puede bloquearse o quitarse, y puedes quedarte sin escribir por un tiempo, ser suspendido o expulsado. Puedes ver las sanciones y pedir una revisión desde tu Perfil.',
    report:
      '¿Viste algo mal? Toca "Denunciar" en el mensaje. El racismo, las amenazas y cualquier cosa que involucre a niños se atienden primero.',
    accept: 'Leí y acepto',
  },
  en: {
    title: 'How the chat works',
    intro:
      'The chat is for cheering together. Teasing the rival is part of the game. Insulting people is not.',
    notAllowedTitle: 'Not allowed here:',
    notAllowed: [
      'insulting anyone for their race, origin, religion, gender, sexual orientation, disability or any other trait',
      'threatening, harassing or humiliating another person',
      'sexual content',
      "sharing a phone number, email, address or ID, yours or someone else's",
      'sharing social media handles or asking people to chat on another app',
      'links outside the allowed sites',
      'betting, odds or sportsbook ads',
      'fixing results or reselling tickets',
      'sending too many messages, repeating the same message or using bots',
    ],
    whoWrites:
      "Only people aged 18 or over can write. If you are 13 to 17, you can read and react. Children under 13 can't join.",
    consequences:
      'If you break a rule, your message may be blocked or removed, and you may be paused from writing for a while, suspended or banned. You can see penalties and ask for a review from your Profile.',
    report:
      'Saw something wrong? Tap "Report" on the message. Racism, threats and anything involving children are handled first.',
    accept: 'I have read and accept',
  },
};

/** As Diretrizes no idioma do Torcedor; português quando o idioma não tem texto. */
export function chatGuidelines(locale?: string): ChatGuidelines {
  const l = locale?.slice(0, 2).toLowerCase();
  return { version: CHAT_GUIDELINES_VERSION, ...TEXT[l === 'es' || l === 'en' ? l : 'pt'] };
}
