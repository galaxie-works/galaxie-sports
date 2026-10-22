/** Descrição das chamadas da API mostradas no botão "Ver código" de cada seção (lib/galaxie/api.ts). */
import { defineMessages } from '../define';

export default defineMessages(
  {
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
    teamOverviewSeason:
      'O time na temporada {season}: campanha em cada competição, tabela, forma e últimos jogos daquele ano (sem próximo jogo). Os anos com dados vêm em `seasons`.',
    squadSeason: 'Elenco e comissão técnica registrados para a temporada {season}.',
    event:
      'Evento completo: participantes, placar, estado, importância (com detalhamento), relevância no mercado, clássico e o que está em jogo.',
    related:
      'Vídeos relacionados ao jogo: links diretos e embed oficial, por tipo (melhores momentos, gols, coletiva…), formato e proporção (16:9/9:16).',
    h2h: 'Histórico do confronto entre os dois participantes, com o resumo de vitórias e gols.',
    eventContext: 'Cenário pré-jogo e resumo pós-jogo gerados a partir dos fatos, com fontes.',
    whereToWatch: 'Onde assistir o evento num país: só opções confirmadas, com meio, confiança e fontes.',
    whereToWatchNote: 'Exige o módulo where_to_watch e o país nos mercados do contrato.',
    lineups: 'Escalações, formação e técnico de cada time.',
    person: 'Jogador, técnico ou piloto: dados pessoais, foto e times (elencos).',
    venue: 'Estádio, circuito ou arena: cidade, capacidade, piso e foto.',
    derby: 'Clássico com história e retrospecto calculado dos jogos na base.',
    requiresModule: 'Exige o módulo {module}.',
    liveEvents: 'Eventos em andamento agora (ao vivo, intervalo, interrompido), por importância.',
    liveEventsNote:
      'Para mudanças em tempo real, assine GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
    timeline:
      'Minuto a minuto: lances com peso de momento-chave, placar parcial, marcos do jogo e disputa de pênaltis. Instantes em UTC.',
  },
  {
    en: {
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
      teamOverviewSeason:
        'The team in the {season} season: campaign in each competition, table, form and last matches of that year (no next match). The years with data come in `seasons`.',
      squadSeason: 'Squad and coaching staff on record for the {season} season.',
      event:
        'Full event: participants, score, status, importance (with breakdown), market relevance, derby and what is at stake.',
      related:
        'Videos related to the match: direct links and official embeds, by type (highlights, goals, press conference…), format and aspect ratio (16:9/9:16).',
      h2h: 'Head-to-head history between the two participants, with a summary of wins and goals.',
      eventContext: 'Pre-match scenario and post-match recap generated from the facts, with sources.',
      whereToWatch:
        'Where to watch the event in a country: confirmed options only, with medium, confidence and sources.',
      whereToWatchNote: 'Requires the where_to_watch module and the country among the contract markets.',
      lineups: "Each team's lineup, formation and coach.",
      person: 'Player, coach or driver: personal data, photo and teams (squads).',
      venue: 'Stadium, circuit or arena: city, capacity, surface and photo.',
      derby: 'Derby with its history and a record computed from the matches in the database.',
      requiresModule: 'Requires the {module} module.',
      liveEvents: 'Events in progress right now (live, half-time, interrupted), by importance.',
      liveEventsNote:
        'For real-time changes, subscribe to GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
      timeline:
        'Play by play: incidents weighted as key moments, running score, match milestones and penalty shootout. Instants in UTC.',
    },
    'es-AR': {
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
      teamOverviewSeason:
        'El equipo en la temporada {season}: campaña en cada competencia, tabla, racha y últimos partidos de ese año (sin próximo partido). Los años con datos vienen en `seasons`.',
      squadSeason: 'Plantel y cuerpo técnico registrados para la temporada {season}.',
      event:
        'Evento completo: participantes, resultado, estado, importancia (con detalle), relevancia en el mercado, clásico y lo que está en juego.',
      related:
        'Videos relacionados con el partido: links directos y embed oficial, por tipo (resumen, goles, conferencia de prensa…), formato y relación de aspecto (16:9/9:16).',
      h2h: 'Historial del cruce entre los dos participantes, con el resumen de victorias y goles.',
      eventContext: 'Previa y resumen del partido generados a partir de los hechos, con fuentes.',
      whereToWatch:
        'Dónde ver el evento en un país: solo opciones confirmadas, con medio, confianza y fuentes.',
      whereToWatchNote: 'Requiere el módulo where_to_watch y el país dentro de los mercados del contrato.',
      lineups: 'Formaciones, esquema y técnico de cada equipo.',
      person: 'Jugador, técnico o piloto: datos personales, foto y equipos (planteles).',
      venue: 'Estadio, circuito o arena: ciudad, capacidad, superficie y foto.',
      derby: 'Clásico con su historia y el historial calculado de los partidos en la base.',
      requiresModule: 'Requiere el módulo {module}.',
      liveEvents: 'Eventos en curso ahora (en vivo, entretiempo, interrumpido), por importancia.',
      liveEventsNote:
        'Para cambios en tiempo real, suscribite a GET /v1/stream?events=<ids>&topics=score,status,incidents (SSE).',
      timeline:
        'Minuto a minuto: jugadas con peso de momento clave, resultado parcial, momentos del partido y definición por penales. Instantes en UTC.',
    },
  },
);
