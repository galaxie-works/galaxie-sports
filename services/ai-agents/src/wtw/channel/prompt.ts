/**
 * Prompt do canal do jogo (docs/07 §2.2.4): a escala de transmissão da rodada (antes) ou quem transmitiu
 * (depois). O modelo responde só com ids da lista; hierarquia de fontes e anti prompt injection.
 */
import type { CountryDirectory } from '@galaxie/where-to-watch';
import { UNTRUSTED_CONTENT_RULES } from '../../llm/hygiene.js';
import { matchLabel, type EventInfo } from '../event-info.js';
import { COUNTRY_NAMES, localKickoff } from '../prompt.js';

export type ChannelPhase = 'pre' | 'post';

/** "Regular Season - 32" → "rodada 32"; "data:2026-10-24" → "jogos de 24/10/2026"; senão o rótulo. */
export function roundLabel(round: string): string {
  if (round.startsWith('data:')) {
    const [y, m, d] = round.slice(5).split('-');
    return `jogos de ${d}/${m}/${y}`;
  }
  const n = /(?:regular season|rodada|fecha|jornada|round)\s*-?\s*(\d+)$/i.exec(round.trim());
  return n ? `rodada ${n[1]}` : round;
}

export function buildChannelSystemPrompt(phase: ChannelPhase): string {
  return [
    'Você é o pesquisador de "onde assistir" da Galaxie Sports para a América Latina.',
    phase === 'pre'
      ? 'Tarefa: descobrir, pela escala de transmissão divulgada para a rodada, qual emissora transmite AO VIVO cada jogo da lista em cada país.'
      : 'Tarefa: confirmar qual emissora TRANSMITIU ao vivo cada jogo da lista (já encerrado) em cada país.',
    'As emissoras e o organizador publicam a escala da rodada inteira e a imprensa esportiva lista "onde assistir" por jogo: prefira essas páginas.',
    'Responda no formato estruturado: uma linha por jogo × país × emissora, usando SÓ os códigos e ids da lista.',
    '',
    'Hierarquia de fontes: 1) organizador da competição; 2) site/redes oficiais da emissora; 3) imprensa esportiva',
    'de referência do país. Guias de TV de terceiros e agregadores não contam como fonte.',
    '',
    'Regras:',
    '- `broadcaster` é o id de um dos detentores listados para aquele país; `channel` é um canal dessa emissora da lista (ou null).',
    '- Cada linha precisa de evidência: a URL exata da fonte e um trecho curto que cite os DOIS times e a emissora/canal.',
    '- Só inclua a linha se a fonte disser que AQUELE jogo passa (ou passou) naquela emissora. Detentor de direitos não basta.',
    '- Jogo sem fonte clara num país: não crie linha (explique em `notes`). Na dúvida, deixe de fora.',
    '- Não confunda com jogos de outras rodadas, temporadas ou competições (confira os dois times e a data).',
    '',
    UNTRUSTED_CONTENT_RULES,
  ].join('\n');
}

export interface ChannelMarket {
  directory: CountryDirectory;
  /** Ids dos detentores a escolher (linha de direitos efetiva). */
  holders: string[];
  /** Códigos dos jogos que este país precisa resolver. */
  matches: string[];
}

export interface ChannelPromptInput {
  competition: { slug: string; name: string };
  season: number | null;
  round: string;
  phase: ChannelPhase;
  matches: { code: string; info: EventInfo }[];
  markets: ChannelMarket[];
}

const countryName = (c: string) => COUNTRY_NAMES[c]?.pt ?? c;

export function buildChannelUserPrompt(input: ChannelPromptInput): string {
  const { competition, round, matches, markets, phase, season } = input;
  const ref = markets[0]?.directory.country ?? 'BR';
  const label = roundLabel(round);
  const lines = [
    `Competição: ${competition.name} (${competition.slug})${season ? ` — temporada ${season}` : ''}`,
    `Rodada: ${label}`,
    phase === 'pre'
      ? 'Momento: antes dos jogos (escala de transmissão).'
      : 'Momento: jogos encerrados (quem transmitiu).',
    '',
    `Jogos (horário local de ${countryName(ref)}; UTC entre parênteses):`,
  ];
  for (const m of matches) {
    const { date, time } = localKickoff(m.info.startsAt, ref);
    lines.push(`- ${m.code}: ${matchLabel(m.info)} — ${date} ${time} (${m.info.startsAt.toISOString()})`);
  }
  lines.push('', 'Países e detentores (id = nome [canais]):');
  for (const mk of markets) {
    lines.push(
      `- ${mk.directory.country} (${countryName(mk.directory.country)}) — jogos: ${mk.matches.join(', ')}`,
    );
    for (const id of mk.holders) {
      const b = mk.directory.byIdOrNull(id);
      if (b) lines.push(`  · ${b.id} = ${b.name}${b.channels.length ? ` [${b.channels.join(', ')}]` : ''}`);
    }
  }
  const comp = `${competition.name}${season ? ` ${season}` : ''}`;
  lines.push(
    '',
    'Consultas sugeridas:',
    `- transmissão ${label} ${comp}`,
    `- onde assistir ${label} ${comp}`,
    `- dónde ver ${competition.name} ${label.replace('rodada', 'fecha')} televisión`,
    ...matches.slice(0, 3).map((m) => `- onde assistir ${matchLabel(m.info)}`),
  );
  return lines.join('\n');
}
