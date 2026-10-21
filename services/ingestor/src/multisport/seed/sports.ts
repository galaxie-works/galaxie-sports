/**
 * Esportes e disciplinas com códigos inspirados no ODF (3 letras). `aliases` são rótulos em inglês usados pelo
 * Wikidata (P641 "esporte" do evento ou prefixo "X at the YYYY ...") — servem para mapear as provas carregadas.
 */

export interface DisciplineSeed {
  code: string;
  sport: string;
  name: { 'pt-BR': string; es: string; en: string };
  twoBronzes?: boolean;
  aliases: string[];
}

export interface SportSeed {
  code: string;
  name: { 'pt-BR': string; es: string; en: string };
}

const n = (pt: string, es: string, en: string) => ({ 'pt-BR': pt, es, en });

export const SPORT_SEED: SportSeed[] = [
  { code: 'AQU', name: n('Esportes aquáticos', 'Deportes acuáticos', 'Aquatics') },
  { code: 'ARC', name: n('Tiro com arco', 'Tiro con arco', 'Archery') },
  { code: 'ATH', name: n('Atletismo', 'Atletismo', 'Athletics') },
  { code: 'BDM', name: n('Badminton', 'Bádminton', 'Badminton') },
  { code: 'BSB', name: n('Beisebol/softbol', 'Béisbol/sóftbol', 'Baseball/Softball') },
  { code: 'BKB', name: n('Basquete', 'Básquetbol', 'Basketball') },
  { code: 'BOX', name: n('Boxe', 'Boxeo', 'Boxing') },
  { code: 'BKG', name: n('Breaking', 'Breaking', 'Breaking') },
  { code: 'CAN', name: n('Canoagem', 'Piragüismo', 'Canoeing') },
  { code: 'CYC', name: n('Ciclismo', 'Ciclismo', 'Cycling') },
  { code: 'EQU', name: n('Hipismo', 'Ecuestre', 'Equestrian') },
  { code: 'FEN', name: n('Esgrima', 'Esgrima', 'Fencing') },
  { code: 'FBL', name: n('Futebol', 'Fútbol', 'Football') },
  { code: 'GLF', name: n('Golfe', 'Golf', 'Golf') },
  { code: 'GYM', name: n('Ginástica', 'Gimnasia', 'Gymnastics') },
  { code: 'HBL', name: n('Handebol', 'Balonmano', 'Handball') },
  { code: 'HOC', name: n('Hóquei sobre grama', 'Hockey sobre césped', 'Hockey') },
  { code: 'JUD', name: n('Judô', 'Judo', 'Judo') },
  { code: 'KTE', name: n('Caratê', 'Karate', 'Karate') },
  { code: 'MPN', name: n('Pentatlo moderno', 'Pentatlón moderno', 'Modern pentathlon') },
  { code: 'ROW', name: n('Remo', 'Remo', 'Rowing') },
  { code: 'RUG', name: n('Rúgbi', 'Rugby', 'Rugby') },
  { code: 'SAL', name: n('Vela', 'Vela', 'Sailing') },
  { code: 'SHO', name: n('Tiro esportivo', 'Tiro deportivo', 'Shooting') },
  { code: 'SKB', name: n('Skate', 'Skateboarding', 'Skateboarding') },
  { code: 'CLB', name: n('Escalada esportiva', 'Escalada deportiva', 'Sport climbing') },
  { code: 'SRF', name: n('Surfe', 'Surf', 'Surfing') },
  { code: 'TTE', name: n('Tênis de mesa', 'Tenis de mesa', 'Table tennis') },
  { code: 'TKW', name: n('Taekwondo', 'Taekwondo', 'Taekwondo') },
  { code: 'TEN', name: n('Tênis', 'Tenis', 'Tennis') },
  { code: 'TRI', name: n('Triatlo', 'Triatlón', 'Triathlon') },
  { code: 'VOL', name: n('Vôlei', 'Vóleibol', 'Volleyball') },
  { code: 'WLF', name: n('Levantamento de peso', 'Halterofilia', 'Weightlifting') },
  { code: 'WRE', name: n('Wrestling', 'Lucha', 'Wrestling') },
  { code: 'RSK', name: n('Patinação', 'Patinaje', 'Roller sports') },
  { code: 'PAM', name: n('Esportes pan-americanos', 'Deportes panamericanos', 'Pan American sports') },
  { code: 'SKI', name: n('Esqui', 'Esquí', 'Skiing') },
  { code: 'SKT', name: n('Patinação no gelo', 'Patinaje sobre hielo', 'Skating') },
  { code: 'BOB', name: n('Bobsled', 'Bobsleigh', 'Bobsleigh') },
  { code: 'BTH', name: n('Biatlo', 'Biatlón', 'Biathlon') },
  { code: 'CUR', name: n('Curling', 'Curling', 'Curling') },
  { code: 'IHO', name: n('Hóquei no gelo', 'Hockey sobre hielo', 'Ice hockey') },
  { code: 'LUG', name: n('Luge', 'Luge', 'Luge') },
  { code: 'HIS', name: n('Modalidades históricas', 'Modalidades históricas', 'Discontinued sports') },
];

export const DISCIPLINE_SEED: DisciplineSeed[] = [
  {
    code: 'SWM',
    sport: 'AQU',
    name: n('Natação', 'Natación', 'Swimming'),
    aliases: ['swimming', 'swimming (sport)'],
  },
  { code: 'DIV', sport: 'AQU', name: n('Saltos ornamentais', 'Clavados', 'Diving'), aliases: ['diving'] },
  { code: 'WPO', sport: 'AQU', name: n('Polo aquático', 'Waterpolo', 'Water polo'), aliases: ['water polo'] },
  {
    code: 'SWA',
    sport: 'AQU',
    name: n('Nado artístico', 'Natación artística', 'Artistic swimming'),
    aliases: ['artistic swimming', 'synchronized swimming', 'synchronised swimming'],
  },
  {
    code: 'OWS',
    sport: 'AQU',
    name: n('Maratona aquática', 'Aguas abiertas', 'Marathon swimming'),
    aliases: ['open water swimming', 'marathon swimming'],
  },
  { code: 'ARC', sport: 'ARC', name: n('Tiro com arco', 'Tiro con arco', 'Archery'), aliases: ['archery'] },
  {
    code: 'ATH',
    sport: 'ATH',
    name: n('Atletismo', 'Atletismo', 'Athletics'),
    aliases: ['athletics', 'track and field', 'sport of athletics'],
  },
  { code: 'BDM', sport: 'BDM', name: n('Badminton', 'Bádminton', 'Badminton'), aliases: ['badminton'] },
  { code: 'BSB', sport: 'BSB', name: n('Beisebol', 'Béisbol', 'Baseball'), aliases: ['baseball'] },
  { code: 'SBL', sport: 'BSB', name: n('Softbol', 'Sóftbol', 'Softball'), aliases: ['softball'] },
  { code: 'BKB', sport: 'BKB', name: n('Basquete', 'Básquetbol', 'Basketball'), aliases: ['basketball'] },
  {
    code: 'BK3',
    sport: 'BKB',
    name: n('Basquete 3x3', 'Básquetbol 3x3', '3x3 basketball'),
    aliases: ['3x3 basketball'],
  },
  {
    code: 'BOX',
    sport: 'BOX',
    name: n('Boxe', 'Boxeo', 'Boxing'),
    twoBronzes: true,
    aliases: ['boxing', 'amateur boxing'],
  },
  {
    code: 'BKG',
    sport: 'BKG',
    name: n('Breaking', 'Breaking', 'Breaking'),
    aliases: ['breaking', 'breakdancing'],
  },
  {
    code: 'CSP',
    sport: 'CAN',
    name: n('Canoagem velocidade', 'Piragüismo de velocidad', 'Canoe sprint'),
    aliases: ['canoe sprint', 'canoeing', 'canoe racing', 'sprint canoe', 'canoe'],
  },
  {
    code: 'CSL',
    sport: 'CAN',
    name: n('Canoagem slalom', 'Piragüismo en eslalon', 'Canoe slalom'),
    aliases: ['canoe slalom', 'slalom canoeing'],
  },
  {
    code: 'CRD',
    sport: 'CYC',
    name: n('Ciclismo de estrada', 'Ciclismo en ruta', 'Cycling road'),
    aliases: ['road bicycle racing', 'road cycling', 'cycling road'],
  },
  {
    code: 'CTR',
    sport: 'CYC',
    name: n('Ciclismo de pista', 'Ciclismo en pista', 'Cycling track'),
    aliases: ['track cycling', 'cycling track'],
  },
  {
    code: 'MTB',
    sport: 'CYC',
    name: n('Mountain bike', 'Ciclismo de montaña', 'Mountain bike'),
    aliases: ['mountain biking', 'cross-country cycling', 'cross-country mountain biking'],
  },
  {
    code: 'BMX',
    sport: 'CYC',
    name: n('BMX corrida', 'BMX carrera', 'BMX racing'),
    aliases: ['bmx racing', 'bmx'],
  },
  {
    code: 'BMF',
    sport: 'CYC',
    name: n('BMX freestyle', 'BMX estilo libre', 'BMX freestyle'),
    aliases: ['bmx freestyle'],
  },
  {
    code: 'CYC',
    sport: 'CYC',
    name: n('Ciclismo', 'Ciclismo', 'Cycling'),
    aliases: ['cycling', 'cycle sport'],
  },
  {
    code: 'EQU',
    sport: 'EQU',
    name: n('Hipismo', 'Ecuestre', 'Equestrian'),
    aliases: ['equestrian', 'equestrianism', 'dressage', 'show jumping', 'eventing', 'equestrian vaulting'],
  },
  { code: 'FEN', sport: 'FEN', name: n('Esgrima', 'Esgrima', 'Fencing'), aliases: ['fencing'] },
  {
    code: 'FBL',
    sport: 'FBL',
    name: n('Futebol', 'Fútbol', 'Football'),
    aliases: ['association football', 'football', 'soccer'],
  },
  { code: 'GLF', sport: 'GLF', name: n('Golfe', 'Golf', 'Golf'), aliases: ['golf'] },
  {
    code: 'GAR',
    sport: 'GYM',
    name: n('Ginástica artística', 'Gimnasia artística', 'Artistic gymnastics'),
    aliases: ['artistic gymnastics', 'gymnastics'],
  },
  {
    code: 'GRY',
    sport: 'GYM',
    name: n('Ginástica rítmica', 'Gimnasia rítmica', 'Rhythmic gymnastics'),
    aliases: ['rhythmic gymnastics'],
  },
  {
    code: 'GTR',
    sport: 'GYM',
    name: n('Ginástica de trampolim', 'Gimnasia en trampolín', 'Trampoline'),
    aliases: ['trampolining', 'trampoline gymnastics', 'trampoline'],
  },
  { code: 'HBL', sport: 'HBL', name: n('Handebol', 'Balonmano', 'Handball'), aliases: ['handball'] },
  {
    code: 'HOC',
    sport: 'HOC',
    name: n('Hóquei sobre grama', 'Hockey sobre césped', 'Hockey'),
    aliases: ['field hockey', 'hockey'],
  },
  { code: 'JUD', sport: 'JUD', name: n('Judô', 'Judo', 'Judo'), twoBronzes: true, aliases: ['judo'] },
  { code: 'KTE', sport: 'KTE', name: n('Caratê', 'Karate', 'Karate'), twoBronzes: true, aliases: ['karate'] },
  {
    code: 'MPN',
    sport: 'MPN',
    name: n('Pentatlo moderno', 'Pentatlón moderno', 'Modern pentathlon'),
    aliases: ['modern pentathlon'],
  },
  { code: 'ROW', sport: 'ROW', name: n('Remo', 'Remo', 'Rowing'), aliases: ['rowing', 'rowing (sport)'] },
  {
    code: 'RU7',
    sport: 'RUG',
    name: n('Rúgbi de sete', 'Rugby 7', 'Rugby sevens'),
    aliases: ['rugby sevens', 'rugby union', 'rugby', 'rugby football'],
  },
  { code: 'SAL', sport: 'SAL', name: n('Vela', 'Vela', 'Sailing'), aliases: ['sailing', 'sailing (sport)'] },
  {
    code: 'SHO',
    sport: 'SHO',
    name: n('Tiro esportivo', 'Tiro deportivo', 'Shooting'),
    aliases: ['shooting sport', 'sport shooting', 'shooting', 'shooting sports'],
  },
  {
    code: 'SKB',
    sport: 'SKB',
    name: n('Skate', 'Skateboarding', 'Skateboarding'),
    aliases: ['skateboarding'],
  },
  {
    code: 'CLB',
    sport: 'CLB',
    name: n('Escalada esportiva', 'Escalada deportiva', 'Sport climbing'),
    aliases: ['sport climbing', 'climbing'],
  },
  { code: 'SRF', sport: 'SRF', name: n('Surfe', 'Surf', 'Surfing'), aliases: ['surfing'] },
  {
    code: 'TTE',
    sport: 'TTE',
    name: n('Tênis de mesa', 'Tenis de mesa', 'Table tennis'),
    aliases: ['table tennis'],
  },
  {
    code: 'TKW',
    sport: 'TKW',
    name: n('Taekwondo', 'Taekwondo', 'Taekwondo'),
    twoBronzes: true,
    aliases: ['taekwondo'],
  },
  { code: 'TEN', sport: 'TEN', name: n('Tênis', 'Tenis', 'Tennis'), aliases: ['tennis'] },
  { code: 'TRI', sport: 'TRI', name: n('Triatlo', 'Triatlón', 'Triathlon'), aliases: ['triathlon'] },
  {
    code: 'VVO',
    sport: 'VOL',
    name: n('Vôlei', 'Vóleibol', 'Volleyball'),
    aliases: ['volleyball', 'indoor volleyball'],
  },
  {
    code: 'VBV',
    sport: 'VOL',
    name: n('Vôlei de praia', 'Vóley playa', 'Beach volleyball'),
    aliases: ['beach volleyball'],
  },
  {
    code: 'WLF',
    sport: 'WLF',
    name: n('Levantamento de peso', 'Halterofilia', 'Weightlifting'),
    aliases: ['weightlifting', 'olympic weightlifting'],
  },
  {
    code: 'WRE',
    sport: 'WRE',
    name: n('Wrestling', 'Lucha', 'Wrestling'),
    twoBronzes: true,
    aliases: ['wrestling', 'amateur wrestling', 'freestyle wrestling', 'greco-roman wrestling'],
  },
  {
    code: 'RSK',
    sport: 'RSK',
    name: n('Patinação', 'Patinaje', 'Roller sports'),
    aliases: ['roller sports', 'artistic roller skating', 'inline speed skating', 'roller skating'],
  },
  {
    code: 'SQU',
    sport: 'PAM',
    name: n('Squash', 'Squash', 'Squash'),
    twoBronzes: true,
    aliases: ['squash', 'squash (sport)'],
  },
  {
    code: 'RQB',
    sport: 'PAM',
    name: n('Raquetebol', 'Ráquetbol', 'Racquetball'),
    twoBronzes: true,
    aliases: ['racquetball'],
  },
  {
    code: 'BOW',
    sport: 'PAM',
    name: n('Boliche', 'Bolos', 'Bowling'),
    aliases: ['bowling', 'ten-pin bowling'],
  },
  {
    code: 'PEL',
    sport: 'PAM',
    name: n('Pelota basca', 'Pelota vasca', 'Basque pelota'),
    aliases: ['basque pelota'],
  },
  {
    code: 'WSK',
    sport: 'PAM',
    name: n('Esqui aquático', 'Esquí acuático', 'Water skiing'),
    aliases: ['water skiing', 'waterskiing'],
  },
  {
    code: 'ALP',
    sport: 'SKI',
    name: n('Esqui alpino', 'Esquí alpino', 'Alpine skiing'),
    aliases: ['alpine skiing'],
  },
  {
    code: 'CCS',
    sport: 'SKI',
    name: n('Esqui cross-country', 'Esquí de fondo', 'Cross-country skiing'),
    aliases: ['cross-country skiing'],
  },
  {
    code: 'FRS',
    sport: 'SKI',
    name: n('Esqui estilo livre', 'Esquí acrobático', 'Freestyle skiing'),
    aliases: ['freestyle skiing'],
  },
  {
    code: 'NCB',
    sport: 'SKI',
    name: n('Combinado nórdico', 'Combinada nórdica', 'Nordic combined'),
    aliases: ['nordic combined'],
  },
  {
    code: 'SJP',
    sport: 'SKI',
    name: n('Salto de esqui', 'Salto de esquí', 'Ski jumping'),
    aliases: ['ski jumping'],
  },
  {
    code: 'SBD',
    sport: 'SKI',
    name: n('Snowboard', 'Snowboard', 'Snowboard'),
    aliases: ['snowboarding', 'snowboard'],
  },
  {
    code: 'SMT',
    sport: 'SKI',
    name: n('Esqui de montanha', 'Esquí de montaña', 'Ski mountaineering'),
    aliases: ['ski mountaineering'],
  },
  {
    code: 'FSK',
    sport: 'SKT',
    name: n('Patinação artística', 'Patinaje artístico', 'Figure skating'),
    aliases: ['figure skating'],
  },
  {
    code: 'SSK',
    sport: 'SKT',
    name: n('Patinação de velocidade', 'Patinaje de velocidad', 'Speed skating'),
    aliases: ['speed skating', 'long track speed skating'],
  },
  {
    code: 'STK',
    sport: 'SKT',
    name: n('Patinação de velocidade em pista curta', 'Patinaje de velocidad en pista corta', 'Short track'),
    aliases: ['short track speed skating', 'short-track speed skating'],
  },
  {
    code: 'BOB',
    sport: 'BOB',
    name: n('Bobsled', 'Bobsleigh', 'Bobsleigh'),
    aliases: ['bobsleigh', 'bobsled'],
  },
  { code: 'SKN', sport: 'BOB', name: n('Skeleton', 'Skeleton', 'Skeleton'), aliases: ['skeleton'] },
  { code: 'BTH', sport: 'BTH', name: n('Biatlo', 'Biatlón', 'Biathlon'), aliases: ['biathlon'] },
  { code: 'CUR', sport: 'CUR', name: n('Curling', 'Curling', 'Curling'), aliases: ['curling'] },
  {
    code: 'IHO',
    sport: 'IHO',
    name: n('Hóquei no gelo', 'Hockey sobre hielo', 'Ice hockey'),
    aliases: ['ice hockey'],
  },
  { code: 'LUG', sport: 'LUG', name: n('Luge', 'Luge', 'Luge'), aliases: ['luge'] },
  {
    code: 'HIS',
    sport: 'HIS',
    name: n('Modalidade histórica', 'Modalidad histórica', 'Discontinued sport'),
    aliases: [
      'tug of war',
      'polo',
      'cricket',
      'lacrosse',
      'rackets',
      'jeu de paume',
      'croquet',
      'roque',
      'motorboating',
      'motorsport',
      'military patrol',
      'alpinism',
      'aeronautics',
      'water motorsports',
    ],
  },
];

/**
 * Competições que o COI não conta mais no quadro de medalhas (concursos de arte 1912–1948)
 * e esportes de demonstração: provas com estes rótulos são ignoradas na carga.
 */
export const EXCLUDED_SPORT_ALIASES = [
  'art competitions',
  'art competition',
  'demonstration sport',
  // modalidades que só apareceram como demonstração (sem medalha oficial)
  'bandy',
  'winter pentathlon',
  'skijoring',
  'sled dog racing',
  'ice stock sport',
  'speed skiing',
  'pesäpallo',
  'gliding',
];

/** Mapa rótulo (en, minúsculo) → código da disciplina. */
export function disciplineAliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of DISCIPLINE_SEED) for (const a of d.aliases) map.set(a.toLowerCase(), d.code);
  return map;
}
