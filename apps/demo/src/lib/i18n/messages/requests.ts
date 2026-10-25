/** Descrição das chamadas da API mostradas no botão "Ver código" de cada seção (lib/galaxie/api.ts). */
import { defineMessages } from '../define';

export default defineMessages(
  {
    exploreSummary:
      'Vitrine inicial em uma chamada: por esporte e por país, contadores, competições e clubes em destaque, ao vivo e o jogo de maior relevância.',
    exploreSummaryNote:
      'Feita para a home: sete consultas em lote na API, sem N+1, e cache de 60 s (os contadores envelhecem até 1 min).',
    countryCompetitions:
      'Competições do país por esporte e escopo: nacionais, continentais, seleção e mundiais.',
    sportCompetitions: 'Competições catalogadas de um esporte, paginadas por cursor.',
    sportCompetitionsNote: 'A página repete a chamada com tier=2 e segue o next_cursor até o fim.',
    competition: 'Detalhe da competição (aceita UUID ou slug), com apelidos e temporadas.',
    standings: 'Tabela ou grupos da temporada (o ano ou `current`).',
    competitionEvents: 'Jogos da competição na janela da temporada, paginados por cursor.',
    competitionEventsNote:
      'A página segue o next_cursor (envie ?cursor=<next_cursor>) até juntar a temporada inteira.',
    teamOverview:
      'Card do time em uma chamada: posição nas competições, forma, últimos jogos, ao vivo e próximo jogo.',
    teamSemantic:
      'Cartão de identidade do time: apelidos, mascote, torcida, gritos, estádio, rivais e fatos.',
    squad: 'Elenco atual e comissão técnica (envie ?season=AAAA para outra temporada).',
    raceLegends:
      'Lendas da Fórmula 1: campeões e os maiores em vitórias e GPs, com a temporada marcante, a cor da equipe, o carro e o retrato.',
    teamCareer:
      'Carreira na Fórmula 1: temporada a temporada, títulos, vitórias, poles, pódios, equipes e companheiros.',
    teamPhotos: 'Fotos de licença livre (Wikimedia Commons), cada uma com autor, licença e página de origem.',
    teamTraits:
      'Traços do piloto calculados do histórico: pistas preferidas, sábado × domingo, duelo com os companheiros e consistência.',
    teamEditorial:
      'Perfil editorial do piloto (bio, estilo, pontos fortes, momentos e rivalidades), cada item com a fonte; só o aprovado.',
    teamOverviewSeason:
      'O time na temporada {season}: campanha em cada competição, tabela, forma e últimos jogos daquele ano (sem próximo jogo). Os anos com dados vêm em `seasons`.',
    squadSeason:
      'Elenco da temporada {season}: inscritos e quem entrou em campo, com jogos e gols das escalações.',
    event:
      'Evento completo: participantes, placar, estado, importância (com detalhamento), relevância no mercado e em cada país, clássico e o que está em jogo.',
    related:
      'Vídeos relacionados ao jogo: links diretos e embed oficial, por tipo (melhores momentos, gols, coletiva…), formato e proporção (16:9/9:16).',
    eventCard: 'Card de MMA da luta: todas as lutas da noite, do card principal às preliminares iniciais.',
    h2h: 'Histórico do confronto entre os dois participantes, com o resumo de vitórias e gols.',
    eventContext: 'Cenário pré-jogo e resumo pós-jogo gerados a partir dos fatos, com fontes.',
    whereToWatch: 'Onde assistir o evento num país: só opções confirmadas, com meio, confiança e fontes.',
    whereToWatchNote: 'Exige o módulo where_to_watch e o país nos mercados do contrato.',
    lineups: 'Escalações, formação e técnico de cada time.',
    stats: 'Estatísticas de cada time com código estável, rótulo no idioma e valor numérico.',
    person: 'Jogador, técnico ou piloto: dados pessoais, foto e times (elencos).',
    personOverview:
      'Perfil do jogador: time atual, números por competição, carreira, transferências e últimos jogos.',
    personOverviewSeason: 'Perfil do jogador com os números e os jogos da temporada {season}.',
    venue: 'Estádio, circuito ou arena: cidade, capacidade, piso e foto.',
    derby:
      'Clássico com história, histórico geral curado (com fonte e data) e o recorte calculado dos jogos da nossa base.',
    requiresModule: 'Exige o módulo {module}.',
    liveEvents: 'Eventos em andamento agora (ao vivo, intervalo, interrompido), por importância.',
    liveEventsNote:
      'Para mudanças em tempo real, assine GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
    timeline:
      'Minuto a minuto: lances com peso de momento-chave, placar parcial, marcos do jogo e disputa de pênaltis. Instantes em UTC.',
  },
  {
    en: {
      exploreSummary:
        'The landing page in one call: per sport and per country, counters, featured competitions and clubs, live games and the most relevant upcoming match.',
      exploreSummaryNote:
        'Built for the home page: seven batched queries in the API, no N+1, and a 60 s cache (counters lag at most 1 min).',
      countryCompetitions:
        "The country's competitions by sport and scope: domestic, continental, national team and world.",
      sportCompetitions: "A sport's catalogued competitions, paginated by cursor.",
      sportCompetitionsNote: 'The page repeats the call with tier=2 and follows next_cursor to the end.',
      competition: 'Competition detail (accepts a UUID or slug), with nicknames and seasons.',
      standings: 'Standings or groups for the season (the year or `current`).',
      competitionEvents: "The competition's matches within the season window, paginated by cursor.",
      competitionEventsNote:
        'The page follows next_cursor (send ?cursor=<next_cursor>) until it has the whole season.',
      teamOverview:
        'The team card in one call: position in each competition, form, recent matches, live and next match.',
      teamSemantic:
        "The team's identity card: nicknames, mascot, fan base, chants, stadium, rivals and facts.",
      squad: 'Current squad and coaching staff (send ?season=YYYY for another season).',
      raceLegends:
        'Formula 1 legends: champions and the greats in wins and Grands Prix, with the defining season, team color, car and portrait.',
      teamCareer: 'Formula 1 career: season by season, titles, wins, poles, podiums, teams and teammates.',
      teamPhotos: 'Freely licensed photos (Wikimedia Commons), each with author, license and source page.',
      teamTraits:
        "The driver's traits computed from the record: favourite tracks, Saturday vs Sunday, teammate battle and consistency.",
      teamEditorial:
        "The driver's editorial profile (bio, style, strengths, moments and rivalries), each item with its source; approved only.",
      teamOverviewSeason:
        'The team in the {season} season: campaign in each competition, table, form and last matches of that year (no next match). The years with data come in `seasons`.',
      squadSeason:
        'Squad for the {season} season: registered players and everyone who played, with matches and goals from the lineups.',
      event:
        'Full event: participants, score, status, importance (with breakdown), market and per-country relevance, derby and what is at stake.',
      related:
        'Videos related to the match: direct links and official embeds, by type (highlights, goals, press conference…), format and aspect ratio (16:9/9:16).',
      eventCard: 'MMA fight card: every fight of the night, from the main card to the early prelims.',
      h2h: 'Head-to-head history between the two participants, with a summary of wins and goals.',
      eventContext: 'Pre-match scenario and post-match recap generated from the facts, with sources.',
      whereToWatch:
        'Where to watch the event in a country: confirmed options only, with medium, confidence and sources.',
      whereToWatchNote: 'Requires the where_to_watch module and the country among the contract markets.',
      lineups: "Each team's lineup, formation and coach.",
      stats: "Each team's stats with a stable code, a localized label and a numeric value.",
      person: 'Player, coach or driver: personal data, photo and teams (squads).',
      personOverview:
        'Player profile: current team, numbers by competition, career, transfers and latest matches.',
      personOverviewSeason: 'Player profile with the numbers and matches of the {season} season.',
      venue: 'Stadium, circuit or arena: city, capacity, surface and photo.',
      derby:
        'Derby with its history, a curated all-time record (with source and date) and the record computed from the matches in our database.',
      requiresModule: 'Requires the {module} module.',
      liveEvents: 'Events in progress right now (live, half-time, interrupted), by importance.',
      liveEventsNote:
        'For real-time changes, subscribe to GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
      timeline:
        'Play by play: incidents weighted as key moments, running score, match milestones and penalty shootout. Instants in UTC.',
    },
    'es-AR': {
      exploreSummary:
        'La vidriera inicial en una llamada: por deporte y por país, contadores, competencias y clubes destacados, en vivo y el partido de mayor relevancia.',
      exploreSummaryNote:
        'Pensada para la home: siete consultas en lote en la API, sin N+1, y caché de 60 s (los contadores se atrasan hasta 1 min).',
      countryCompetitions:
        'Competencias del país por deporte y alcance: nacionales, continentales, selección y mundiales.',
      sportCompetitions: 'Competencias catalogadas de un deporte, paginadas por cursor.',
      sportCompetitionsNote: 'La página repite la llamada con tier=2 y sigue el next_cursor hasta el final.',
      competition: 'Detalle de la competencia (acepta UUID o slug), con apodos y temporadas.',
      standings: 'Tabla o grupos de la temporada (el año o `current`).',
      competitionEvents: 'Partidos de la competencia en la ventana de la temporada, paginados por cursor.',
      competitionEventsNote:
        'La página sigue el next_cursor (mandá ?cursor=<next_cursor>) hasta juntar la temporada entera.',
      teamOverview:
        'La ficha del equipo en una llamada: posición en las competencias, racha, últimos partidos, en vivo y próximo partido.',
      teamSemantic:
        'La tarjeta de identidad del equipo: apodos, mascota, hinchada, cantitos, estadio, rivales y datos.',
      squad: 'Plantel actual y cuerpo técnico (mandá ?season=AAAA para otra temporada).',
      raceLegends:
        'Leyendas de la Fórmula 1: campeones y los más grandes en victorias y GP, con la temporada clave, el color del equipo, el auto y el retrato.',
      teamCareer:
        'Carrera en la Fórmula 1: temporada por temporada, títulos, victorias, poles, podios, equipos y compañeros.',
      teamPhotos:
        'Fotos de licencia libre (Wikimedia Commons), cada una con autor, licencia y página de origen.',
      teamTraits:
        'Rasgos del piloto calculados del historial: pistas preferidas, sábado vs. domingo, duelo con los compañeros y regularidad.',
      teamEditorial:
        'Perfil editorial del piloto (bio, estilo, puntos fuertes, momentos y rivalidades), cada ítem con su fuente; solo lo aprobado.',
      teamOverviewSeason:
        'El equipo en la temporada {season}: campaña en cada competencia, tabla, racha y últimos partidos de ese año (sin próximo partido). Los años con datos vienen en `seasons`.',
      squadSeason:
        'Plantel de la temporada {season}: inscriptos y quienes jugaron, con partidos y goles de las formaciones.',
      event:
        'Evento completo: participantes, resultado, estado, importancia (con detalle), relevancia en el mercado y en cada país, clásico y lo que está en juego.',
      related:
        'Videos relacionados con el partido: links directos y embed oficial, por tipo (resumen, goles, conferencia de prensa…), formato y relación de aspecto (16:9/9:16).',
      eventCard:
        'Cartelera de MMA de la pelea: todas las peleas de la noche, de la principal a las preliminares iniciales.',
      h2h: 'Historial del cruce entre los dos participantes, con el resumen de victorias y goles.',
      eventContext: 'Previa y resumen del partido generados a partir de los hechos, con fuentes.',
      whereToWatch:
        'Dónde ver el evento en un país: solo opciones confirmadas, con medio, confianza y fuentes.',
      whereToWatchNote: 'Requiere el módulo where_to_watch y el país dentro de los mercados del contrato.',
      lineups: 'Formaciones, esquema y técnico de cada equipo.',
      stats: 'Estadísticas de cada equipo con código estable, etiqueta en el idioma y valor numérico.',
      person: 'Jugador, técnico o piloto: datos personales, foto y equipos (planteles).',
      personOverview:
        'Perfil del jugador: equipo actual, números por competición, carrera, transferencias y últimos partidos.',
      personOverviewSeason: 'Perfil del jugador con los números y los partidos de la temporada {season}.',
      venue: 'Estadio, circuito o arena: ciudad, capacidad, superficie y foto.',
      derby:
        'Clásico con su historia, el historial general curado (con fuente y fecha) y el historial calculado de los partidos de nuestra base.',
      requiresModule: 'Requiere el módulo {module}.',
      liveEvents: 'Eventos en curso ahora (en vivo, entretiempo, interrumpido), por importancia.',
      liveEventsNote:
        'Para cambios en tiempo real, suscribite a GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
      timeline:
        'Minuto a minuto: jugadas con peso de momento clave, resultado parcial, momentos del partido y definición por penales. Instantes en UTC.',
    },
  },
);
