/**
 * Prompt do agente Onde Assistir (docs/07 §2.2): hierarquia de fontes por país, consultas em pt/es,
 * tabela de direitos como ponto de partida e regras anti-alucinação / anti prompt injection.
 */
import type { CountryDirectory, RightsEntry } from '@galaxie/where-to-watch';
import { UNTRUSTED_CONTENT_RULES } from '../llm/hygiene.js';
import { matchLabel, type EventInfo } from './event-info.js';

export const COUNTRY_TZ: Record<string, string> = {
  BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires',
  MX: 'America/Mexico_City',
  CO: 'America/Bogota',
  CL: 'America/Santiago',
  PE: 'America/Lima',
  UY: 'America/Montevideo',
  EC: 'America/Guayaquil',
};

export const COUNTRY_NAMES: Record<string, { pt: string; es: string }> = {
  BR: { pt: 'Brasil', es: 'Brasil' },
  AR: { pt: 'Argentina', es: 'Argentina' },
  MX: { pt: 'México', es: 'México' },
  CO: { pt: 'Colômbia', es: 'Colombia' },
  CL: { pt: 'Chile', es: 'Chile' },
  PE: { pt: 'Peru', es: 'Perú' },
  UY: { pt: 'Uruguai', es: 'Uruguay' },
  EC: { pt: 'Equador', es: 'Ecuador' },
};

/** Data e hora locais do jogo no país (dd/mm/aaaa, HH:mm). */
export function localKickoff(startsAt: Date, country: string): { date: string; time: string } {
  const tz = COUNTRY_TZ[country] ?? 'UTC';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(startsAt)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.day}/${parts.month}/${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}

/** Consultas sugeridas, no idioma do país (pt no Brasil, es nos demais). */
export function buildQueries(info: EventInfo, country: string, holderNames: string[] = []): string[] {
  const { date } = localKickoff(info.startsAt, country);
  const comp = info.competition?.name ?? '';
  const name = COUNTRY_NAMES[country]?.es ?? country;
  const queries =
    country === 'BR'
      ? [
          `onde assistir ${matchLabel(info, 'x')} ${date}`,
          `${matchLabel(info, 'x')} transmissão ao vivo ${comp}`.trim(),
          ...holderNames.slice(0, 3).map((h) => `${matchLabel(info, 'x')} ${h}`),
        ]
      : [
          `dónde ver ${matchLabel(info, 'vs')} ${date} ${name}`,
          `${matchLabel(info, 'vs')} transmisión en vivo ${comp} ${name}`.replace(/\s+/g, ' ').trim(),
          `canal ${matchLabel(info, 'vs')} ${name}`,
          ...holderNames.slice(0, 3).map((h) => `${matchLabel(info, 'vs')} ${h} ${name}`),
        ];
  return [...new Set(queries)];
}

export interface PreviousOption {
  provider: string;
  channel: string | null;
  region: string | null;
  status: string;
  sources: string[];
}

export interface WtwPromptInput {
  info: EventInfo;
  directory: CountryDirectory;
  rights: RightsEntry | null;
  previous: PreviousOption[];
}

export function buildSystemPrompt(country: string): string {
  const name = COUNTRY_NAMES[country]?.pt ?? country;
  return [
    `Você é o pesquisador de "onde assistir" da Galaxie Sports para o mercado ${name} (${country}).`,
    'Tarefa: descobrir, com fontes, onde o jogo informado pode ser assistido AO VIVO nesse país (TV aberta, TV paga,',
    'streaming, YouTube, app oficial). Responda chamando o formato estruturado pedido.',
    '',
    'Hierarquia de fontes (prefira nesta ordem):',
    '1) organizador da competição; 2) site/redes oficiais da emissora ou plataforma; 3) clubes;',
    '4) imprensa esportiva de referência do país. Agregadores (guias de TV de terceiros) servem só como pista',
    'para achar a fonte primária — não os use como única evidência.',
    '',
    'Regras:',
    '- Cada opção precisa de evidência: URL exata da página consultada + trecho curto (até 200 caracteres) que',
    '  sustenta a informação. Sem evidência, não inclua a opção. Nunca invente URL.',
    '- Use `stance: "denies"` quando a fonte disser explicitamente que a emissora NÃO transmite o jogo.',
    '- Transmissão regional (TV aberta por praça/UF no Brasil): preencha `region` com a UF; senão `null`.',
    '- Liste emissoras, canais e plataformas — não liste operadoras/distribuidoras de TV paga.',
    '- Se nada confiável for encontrado, devolva `options: []` e explique em `notes`.',
    '- Informe `published_at` quando a página trouxer data; escolhas por rodada mudam e fontes velhas valem menos.',
    '',
    UNTRUSTED_CONTENT_RULES,
  ].join('\n');
}

export function buildUserPrompt(input: WtwPromptInput): string {
  const { info, directory, rights, previous } = input;
  const country = directory.country;
  const { date, time } = localKickoff(info.startsAt, country);
  const holders = (rights?.holders ?? []).map((id) => directory.byIdOrNull(id)?.name ?? id);
  const uncertain = (rights?.uncertainHolders ?? []).map((id) => directory.byIdOrNull(id)?.name ?? id);
  const lines = [
    `Jogo: ${matchLabel(info)}`,
    `Competição: ${info.competition?.name ?? 'desconhecida'}`,
    `Início (horário local de ${COUNTRY_NAMES[country]?.pt ?? country}): ${date} ${time} (UTC: ${info.startsAt.toISOString()})`,
    `País: ${country}`,
    '',
    'Detentores de direitos conhecidos (ponto de partida — confirme jogo a jogo):',
    holders.length ? `- ${holders.join(', ')}` : '- (sem tabela de direitos para esta competição neste país)',
    ...(uncertain.length ? [`- incertos: ${uncertain.join(', ')}`] : []),
    ...(rights?.perRoundSelection
      ? ['- Atenção: a emissora escolhe o jogo por rodada; prefira fontes recentes.']
      : []),
    '',
    `Emissoras e plataformas conhecidas no país: ${directory.broadcasters.map((b) => b.name).join(', ')}.`,
    '',
    'Consultas sugeridas:',
    ...buildQueries(info, country, holders).map((q) => `- ${q}`),
  ];
  if (previous.length) {
    lines.push(
      '',
      'Opções encontradas antes (confirme, corrija ou deixe de fora se não se sustentarem mais):',
    );
    for (const p of previous)
      lines.push(
        `- ${p.provider}${p.channel ? ` (${p.channel})` : ''}${p.region ? ` [${p.region}]` : ''} — ${p.status}; fontes: ${p.sources.join(' ')}`,
      );
  }
  return lines.join('\n');
}
