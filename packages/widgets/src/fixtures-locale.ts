// ─── Dados de exemplo no idioma do widget ────────────────────────────────────────────────────────
// Os dados de exemplo (`createPreviewFetch`) são escritos em português. A API real responde no `?locale`
// pedido; aqui a resposta de exemplo passa pelo mesmo caminho: com `locale=en` ou `locale=es-*`, os nomes
// fictícios (liga, estádio, rodada, fases, planos, canais...) e os textos fixos saem no idioma do widget,
// para a prévia do Builder e do editor de tema não misturar interface em inglês com dados em português.
// Times e pessoas fictícios mantêm o nome (como nomes próprios na API).

type Lang = 'es' | 'en';

/** pt-BR → [espanhol, inglês]. Só textos inteiros (o valor do campo, não pedaços). */
export const SAMPLE_TEXTS: Record<string, [string, string]> = {
  'Liga Exemplo': ['Liga Ejemplo', 'Sample League'],
  'Copa Exemplo': ['Copa Ejemplo', 'Sample Cup'],
  'Estadual Exemplo': ['Torneo Regional Ejemplo', 'Sample State League'],
  'Arena Exemplo': ['Estadio Ejemplo', 'Sample Arena'],
  'Cidade Exemplo': ['Ciudad Ejemplo', 'Sample City'],
  'Estádio Aurora': ['Estadio Aurora', 'Aurora Stadium'],
  'Estádio Aquático': ['Centro Acuático', 'Aquatics Centre'],
  'TV Exemplo': ['TV Ejemplo', 'Sample TV'],
  'TV Online Exemplo': ['TV Online Ejemplo', 'Sample Online TV'],
  'Canal Exemplo': ['Canal Ejemplo', 'Sample Channel'],
  'Canal Esporte Exemplo': ['Canal Deporte Ejemplo', 'Sample Sports Channel'],
  'Esporte Exemplo 2': ['Deporte Ejemplo 2', 'Sample Sports 2'],
  'Operadora Exemplo': ['Operador Ejemplo', 'Sample Provider'],
  'Operadora Exemplo Play': ['Operador Ejemplo Play', 'Sample Provider Play'],
  'Exemplo Play': ['Ejemplo Play', 'Sample Play'],
  'Passa em Exemplo Play': ['Se ve en Ejemplo Play', 'Streaming on Sample Play'],
  'Plano Completo': ['Plan Completo', 'Full Plan'],
  'Plano Esportes': ['Plan Deportes', 'Sports Plan'],
  'Plano Essencial': ['Plan Esencial', 'Essential Plan'],
  'Plano Padrão': ['Plan Estándar', 'Standard Plan'],
  'Clássico da Serra': ['Clásico de la Sierra', 'Serra Derby'],
  'Clássico do Vale': ['Clásico del Valle', 'Vale Derby'],
  'Quartas de final': ['Cuartos de final', 'Quarter-finals'],
  Semifinal: ['Semifinal', 'Semi-final'],
  Final: ['Final', 'Final'],
  Eliminatórias: ['Eliminatorias', 'Qualifiers'],
  Classificação: ['Clasificación', 'Qualifying'],
  'Treino livre 1': ['Práctica libre 1', 'Free Practice 1'],
  'Treino livre 2': ['Práctica libre 2', 'Free Practice 2'],
  'Decisão unânime': ['Decisión unánime', 'Unanimous decision'],
  'Nocaute técnico': ['Nocaut técnico', 'Technical knockout'],
  Finalização: ['Sumisión', 'Submission'],
  'Mata-leão': ['Mataleón', 'Rear-naked choke'],
  'Peso-médio': ['Peso mediano', 'Middleweight'],
  'Lesão no joelho': ['Lesión de rodilla', 'Knee injury'],
  'Lesão na coxa (posterior)': ['Lesión en el isquiotibial', 'Hamstring injury'],
  Doença: ['Enfermedad', 'Illness'],
  'Cartões amarelos': ['Tarjetas amarillas', 'Yellow cards'],
  'Melhores momentos': ['Mejores momentos', 'Highlights'],
  Coletiva: ['Conferencia de prensa', 'Press conference'],
  Entrevista: ['Entrevista', 'Interview'],
  Análise: ['Análisis', 'Analysis'],
  Pênaltis: ['Penales', 'Penalties'],
  Torcida: ['Hinchada', 'Fans'],
  'Na briga pelo título': ['En la pelea por el título', 'In the title race'],
  'De olho no G-4': ['Con la mira en el top 4', 'Eyeing the top 4'],
  'Contra o rebaixamento': ['Contra el descenso', 'Fighting relegation'],
  'Precisa pontuar para sair do Z-4': [
    'Necesita sumar para salir de la zona de descenso',
    'Needs points to climb out of the relegation zone',
  ],
  'Com vitória, assume a liderança': ['Con una victoria, pasa a ser líder', 'A win puts them top'],
  'Invicto em casa há 8 jogos': ['Invicto de local hace 8 partidos', 'Unbeaten in 8 home games'],
  'Vale a melhor campanha no clássico do ano': [
    'Vale la mejor campaña en el clásico del año',
    'Vale’s best run in the derby of the year',
  ],
  'A festa da torcida no apito final': [
    'La fiesta de la hinchada en el pitazo final',
    'Fans celebrate at the final whistle',
  ],
  'Coletiva do técnico do Sporting Vale': [
    'Conferencia de prensa del DT del Sporting Vale',
    'Sporting Vale coach’s press conference',
  ],
  'Como o Planalto segurou o Vale no segundo tempo': [
    'Cómo Planalto aguantó al Vale en el segundo tiempo',
    'How Planalto held off Vale in the second half',
  ],
  'Todas as cobranças da disputa de pênaltis': [
    'Todos los penales de la tanda',
    'Every kick of the shootout',
  ],
  'Planalto 0 (4) x (3) 0 Vale: melhores momentos': [
    'Planalto 0 (4) x (3) 0 Vale: mejores momentos',
    'Planalto 0 (4) x (3) 0 Vale: highlights',
  ],
  'Goleiro do Planalto: "a gente treinou cada cobrança"': [
    'Arquero de Planalto: "entrenamos cada penal"',
    'Planalto goalkeeper: "we practised every kick"',
  ],
  'Líder da Liga Exemplo, o Aurora recebe o Estrela do Sul precisando vencer para abrir quatro pontos de vantagem. O Estrela não perde há cinco rodadas e chega embalado depois de eliminar o rival na copa.':
    [
      'Líder de la Liga Ejemplo, Aurora recibe a Estrela do Sul con la necesidad de ganar para sacar cuatro puntos de ventaja. Estrela no pierde hace cinco fechas y llega entonado tras eliminar al rival en la copa.',
      'Sample League leaders Aurora host Estrela do Sul needing a win to open a four-point gap. Estrela are unbeaten in five and arrive on a high after knocking their rivals out of the cup.',
    ],
  'O Atlético Serra assume a liderança se vencer o clássico e o Aurora tropeçar. Do outro lado, o União Litoral precisa pontuar para deixar a zona de rebaixamento: perdeu três dos últimos quatro jogos fora de casa.':
    [
      'Atlético Serra pasa a ser líder si gana el clásico y Aurora tropieza. Del otro lado, União Litoral necesita sumar para dejar la zona de descenso: perdió tres de sus últimos cuatro partidos de visitante.',
      'Atlético Serra go top if they win the derby and Aurora slip. União Litoral need points to leave the relegation zone, having lost three of their last four away games.',
    ],
  'O Real Planalto está na final. Depois de um 0 a 0 truncado, com o Vale mais perigoso no segundo tempo, o goleiro do Planalto defendeu duas cobranças e garantiu a vitória por 4 a 3 nos pênaltis.':
    [
      'Real Planalto está en la final. Tras un 0 a 0 trabado, con Vale más peligroso en el segundo tiempo, el arquero de Planalto atajó dos penales y aseguró el 4 a 3 en la tanda.',
      'Real Planalto are into the final. After a scrappy 0-0, with Vale the more dangerous side after the break, the Planalto goalkeeper saved two kicks to seal a 4-3 shootout win.',
    ],
  'Real Planalto e Sporting Vale decidem a vaga na final em jogo único. Em caso de empate, a decisão vai para os pênaltis.':
    [
      'Real Planalto y Sporting Vale definen el pase a la final en partido único. Si empatan, se define por penales.',
      'Real Planalto and Sporting Vale meet in a one-off tie for a place in the final. A draw goes to penalties.',
    ],
  // Jogos (quadro de medalhas, agenda, atletas do país)
  Alemanha: ['Alemania', 'Germany'],
  Espanha: ['España', 'Spain'],
  'Estados Unidos': ['Estados Unidos', 'United States'],
  'Grã-Bretanha': ['Gran Bretaña', 'Great Britain'],
  Itália: ['Italia', 'Italy'],
  Japão: ['Japón', 'Japan'],
  México: ['México', 'Mexico'],
  'Países Baixos': ['Países Bajos', 'Netherlands'],
  'Arena Central': ['Arena Central', 'Central Arena'],
  'Parque Olímpico': ['Parque Olímpico', 'Olympic Park'],
  Atletismo: ['Atletismo', 'Athletics'],
  'Ginástica artística': ['Gimnasia artística', 'Artistic gymnastics'],
  'Ginástica artística · Solo feminino': [
    'Gimnasia artística · Suelo femenino',
    "Artistic gymnastics · Women's floor",
  ],
  'Solo feminino': ['Suelo femenino', "Women's floor"],
  Judô: ['Judo', 'Judo'],
  'Judô · Até 57 kg feminino': ['Judo · Hasta 57 kg femenino', "Judo · Women's 57 kg"],
  Natação: ['Natación', 'Swimming'],
  'Natação · 100 m livre feminino': ['Natación · 100 m libre femenino', "Swimming · Women's 100 m freestyle"],
  'Salto com vara masculino': ['Salto con garrocha masculino', "Men's pole vault"],
  Skate: ['Skate', 'Skateboarding'],
  'Street feminino': ['Street femenino', "Women's street"],
  'Surfe · Masculino': ['Surf · Masculino', "Surfing · Men's"],
  Masculino: ['Masculino', "Men's"],
  'Vôlei de praia': ['Vóley playa', 'Beach volleyball'],
  'Oitavas de final': ['Octavos de final', 'Round of 16'],
  'Ranking Mundial de Salto': ['Ranking Mundial de Salto', 'Show Jumping World Ranking'],
  'Copa das Nações Exemplo': ['Copa de las Naciones Ejemplo', 'Sample Nations Cup'],
  Brasil: ['Brasil', 'Brazil'],
  Austrália: ['Australia', 'Australia'],
  Canadá: ['Canadá', 'Canada'],
  Colômbia: ['Colombia', 'Colombia'],
  'Coreia do Sul': ['Corea del Sur', 'South Korea'],
  França: ['Francia', 'France'],
  'Cidade do México': ['Ciudad de México', 'Mexico City'],
};

/** Padrões com número: "Rodada 12" → "Fecha 12" / "Matchday 12". */
const SAMPLE_PATTERNS: [RegExp, [string, string]][] = [
  [/^Rodada (\d+)$/, ['Fecha $1', 'Matchday $1']],
  [/^Jogos de Exemplo (\d+)$/, ['Juegos de Ejemplo $1', 'Sample Games $1']],
  [/^Jogos Olímpicos Tóquio (\d+)$/, ['Juegos Olímpicos Tokio $1', 'Tokyo $1 Olympics']],
  [/^Jogos Olímpicos (\S+) (\d+)$/, ['Juegos Olímpicos $1 $2', '$1 $2 Olympics']],
  [/^Pan (\S+) (\d+)$/, ['Panamericanos $1 $2', '$1 $2 Pan American Games']],
  [/^Até (\d+) kg feminino$/, ['Hasta $1 kg femenino', "Women's $1 kg"]],
  [/^Boxe · Até (\d+) kg$/, ['Boxeo · Hasta $1 kg', 'Boxing · $1 kg']],
];

function langOf(locale: string | null | undefined): Lang | null {
  if (!locale) return null;
  if (locale.startsWith('es')) return 'es';
  if (locale.startsWith('en')) return 'en';
  return null;
}

function translate(value: string, lang: Lang): string {
  const i = lang === 'es' ? 0 : 1;
  const exact = SAMPLE_TEXTS[value];
  if (exact) return exact[i];
  for (const [re, out] of SAMPLE_PATTERNS) if (re.test(value)) return value.replace(re, out[i]);
  return value;
}

function walk(node: unknown, lang: Lang): unknown {
  if (typeof node === 'string') return translate(node, lang);
  if (Array.isArray(node)) return node.map((n) => walk(n, lang));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v, lang);
    return out;
  }
  return node;
}

/** Corpo de exemplo no idioma pedido à API (`?locale`); pt-BR e sem locale ficam como estão. */
export function localizeSample<T>(body: T, locale: string | null | undefined): T {
  const lang = langOf(locale);
  return lang ? (walk(body, lang) as T) : body;
}
