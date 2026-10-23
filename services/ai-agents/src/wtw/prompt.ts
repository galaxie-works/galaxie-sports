/**
 * Prompts do onde assistir (docs/07 §2.2): direitos por temporada (nível 1) e alocação por rodada
 * (nível 2), ambos para vários países numa só chamada. Hierarquia de fontes, evidência obrigatória
 * e regras anti-alucinação / anti prompt injection.
 */
import type { CountryDirectory } from '@galaxie/where-to-watch';
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

const countryName = (c: string) => COUNTRY_NAMES[c]?.pt ?? c;

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

const SOURCE_RULES = [
  'Hierarquia de fontes (prefira nesta ordem):',
  '1) organizador da competição; 2) site/redes oficiais da emissora ou plataforma; 3) clubes;',
  '4) imprensa esportiva de referência do país. Agregadores (guias de TV de terceiros) servem só como pista',
  'para achar a fonte primária — não os use como única evidência.',
];

const EVIDENCE_RULES = [
  '- Cada item precisa de evidência: URL exata da página consultada + trecho curto (até 160 caracteres) que',
  '  sustenta a informação; no máximo 2 evidências por item. Sem evidência, não inclua. Nunca invente URL.',
  '- Liste emissoras, canais e plataformas — não liste operadoras/distribuidoras de TV paga.',
  '- Informe `published_at` quando a página trouxer data.',
];

// ─── nível 1: direitos por temporada ─────────────────────────────────────────────────────────────

export function buildRightsSystemPrompt(): string {
  return [
    'Você é o pesquisador de direitos de transmissão da Galaxie Sports para a América Latina.',
    'Tarefa: para a competição e a temporada informadas, descobrir em CADA país da lista quem detém os direitos',
    'de transmissão ao vivo (TV aberta, TV paga, streaming, YouTube), com os canais/serviços usados e a regra de',
    'distribuição dos jogos. Direitos são fechados antes da temporada: procure anúncios oficiais e reportagens.',
    'Responda no formato estruturado pedido, um item por país da lista.',
    '',
    ...SOURCE_RULES,
    '',
    'Regras:',
    ...EVIDENCE_RULES,
    '- distribution: exclusive (um detentor, ou canal + streaming do mesmo grupo, com todos os jogos);',
    '  all_matches (todos os detentores listados passam todos os jogos); split (dividem os jogos por rodada);',
    '  selected (só alguns jogos passam); to_confirm (não foi possível saber). Na dúvida, to_confirm.',
    '- all_matches no detentor = ele passa todos os jogos daquela competição no país (só com fonte que diga isso).',
    '- País sem informação confiável: devolva `holders: []`, `distribution: "to_confirm"` e explique em `notes`.',
    '',
    UNTRUSTED_CONTENT_RULES,
  ].join('\n');
}

export interface RightsPromptInput {
  competition: { slug: string; name: string };
  season: number;
  directories: CountryDirectory[];
}

export function buildRightsUserPrompt(input: RightsPromptInput): string {
  const { competition, season, directories } = input;
  const label = `${competition.name} ${season}`;
  const lines = [
    `Competição: ${competition.name} (${competition.slug})`,
    `Temporada: ${season} (ano de início)`,
    '',
    'Países e emissoras/plataformas conhecidas em cada um (use estes nomes quando forem os detentores):',
  ];
  for (const dir of directories)
    lines.push(
      `- ${dir.country} (${countryName(dir.country)}): ${dir.broadcasters.map((b) => b.name).join(', ')}`,
    );
  lines.push(
    '',
    'Consultas sugeridas:',
    `- direitos de transmissão ${label}`,
    `- derechos de transmisión ${label} Latinoamérica`,
    `- dónde ver ${competition.name} ${season} por país`,
  );
  return lines.join('\n');
}

// ─── nível 2: alocação por rodada ────────────────────────────────────────────────────────────────

export function buildAllocationSystemPrompt(): string {
  return [
    'Você é o pesquisador de "onde assistir" da Galaxie Sports para a América Latina.',
    'Tarefa: para os jogos de UMA rodada e para cada país listado, dizer qual detentor (e canal) transmite',
    'cada jogo AO VIVO. As emissoras costumam publicar a grade da rodada inteira: prefira essas páginas.',
    'Responda no formato estruturado pedido: uma linha por jogo × país × emissora.',
    '',
    ...SOURCE_RULES,
    '',
    'Regras:',
    ...EVIDENCE_RULES,
    '- Quando o país traz uma lista de detentores, escolha SÓ entre eles (são os donos dos direitos).',
    '- Use `stance: "denies"` quando a fonte disser explicitamente que a emissora NÃO transmite o jogo.',
    '- Transmissão regional (TV aberta por praça/UF no Brasil): preencha `region` com a UF; senão `null`.',
    '- Jogo sem informação confiável num país: não crie linha para ele (explique em `notes`).',
    '',
    UNTRUSTED_CONTENT_RULES,
  ].join('\n');
}

export interface AllocationMarket {
  directory: CountryDirectory;
  /** Ids dos detentores a escolher; vazio = qualquer emissora do país (reexecução manual sem direitos). */
  holders: string[];
  /** Detentores já garantidos pela tabela (não precisa repetir). */
  known: string[];
  /** Códigos dos jogos que este país precisa alocar. */
  matches: string[];
}

export interface AllocationPromptInput {
  competition: { slug: string; name: string };
  round: string;
  matches: { code: string; info: EventInfo }[];
  markets: AllocationMarket[];
}

export function buildAllocationUserPrompt(input: AllocationPromptInput): string {
  const { competition, round, matches, markets } = input;
  const ref = markets[0]?.directory.country ?? 'BR';
  const lines = [
    `Competição: ${competition.name} (${competition.slug})`,
    `Rodada: ${round.startsWith('data:') ? `jogos de ${round.slice(5)}` : round}`,
    '',
    `Jogos (horário local de ${countryName(ref)}; UTC entre parênteses):`,
  ];
  for (const m of matches) {
    const { date, time } = localKickoff(m.info.startsAt, ref);
    lines.push(
      m.info.timeConfirmed === false
        ? `- ${m.code}: ${matchLabel(m.info)} — ${date}, horário a confirmar (data oficial; jogo anunciado)`
        : `- ${m.code}: ${matchLabel(m.info)} — ${date} ${time} (${m.info.startsAt.toISOString()})`,
    );
  }
  lines.push('', 'Países:');
  for (const mk of markets) {
    const dir = mk.directory;
    const name = (id: string) => {
      const b = dir.byIdOrNull(id);
      return b ? `${b.name}${b.channels.length ? ` [canais: ${b.channels.join(', ')}]` : ''}` : id;
    };
    lines.push(`- ${dir.country} (${countryName(dir.country)}) — jogos: ${mk.matches.join(', ')}`);
    lines.push(
      mk.holders.length
        ? `  detentores a alocar: ${mk.holders.map(name).join('; ')}`
        : `  sem tabela de direitos: procure entre ${dir.broadcasters.map((b) => b.name).join(', ')}`,
    );
    if (mk.known.length) lines.push(`  já garantidos (não repita): ${mk.known.map(name).join('; ')}`);
  }
  lines.push(
    '',
    'Consultas sugeridas:',
    `- ${competition.name} ${round.startsWith('data:') ? round.slice(5) : round} transmissão jogos`,
    `- ${competition.name} programación televisión ${round.startsWith('data:') ? round.slice(5) : round}`,
  );
  return lines.join('\n');
}
