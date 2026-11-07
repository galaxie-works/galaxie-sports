import type { SidelinedCategory, SidelinedPlayer, SidelinedStatus } from '@galaxie/contracts';

/**
 * Regras puras dos desfalques (issue #830): categoria e rótulo do motivo no locale, status do fornecedor,
 * se um afastamento do histórico ainda vale numa data e a ordem da lista.
 */

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SUSPENSION = /\b(card|cards|suspen\w*|ban|banned|sending off|sent off|disciplin\w*)\b/;
const ILLNESS = /\b(ill|illness|sick\w*|virus|viral|flu|influenza|covid\w*|fever|infection|gastro\w*)\b/;
const INJURY =
  /\b(injur\w*|knock|fracture\w*|broken|surgery|strain|sprain|muscle\w*|muscular|tear|torn|ligament\w*|cruciate|acl|meniscus|concussion|knee|ankle|hamstring|thigh|calf|groin|foot|toe|hip|back|shoulder|wrist|hand|arm|elbow|leg|achilles|adductor|abdominal|rib|head|neck|face|nose|jaw|eye|finger|heel|shin|lumbago|pubalgia|bruise\w*|contusion|tendon\w*|inflammation|fitness|physical)\b/;

/** Categoria pelo texto do fornecedor ("Hamstring Injury", "Red Card", "Suspended", "Illness"…). */
export function sidelinedCategory(reason: string | null | undefined): SidelinedCategory {
  const r = plain(reason ?? '');
  if (!r) return 'other';
  if (SUSPENSION.test(r)) return 'suspension';
  if (ILLNESS.test(r)) return 'illness';
  if (INJURY.test(r)) return 'injury';
  return 'other';
}

/** "Missing Fixture" → fora; "Questionable" (e variações) → dúvida. */
export function sidelinedStatus(type: string | null | undefined): SidelinedStatus {
  return /question|doubt|uncertain|probable/i.test(type ?? '') ? 'doubtful' : 'out';
}

type Loc = 'pt' | 'es' | 'en';
const lang = (locale: string): Loc =>
  locale.startsWith('pt') ? 'pt' : locale.startsWith('es') ? 'es' : 'en';

/** Motivos mais comuns da api-sports, pelo texto sem caixa nem pontuação. */
const REASONS: Record<string, Record<Loc, string>> = {
  'red card': { pt: 'Cartão vermelho', es: 'Tarjeta roja', en: 'Red card' },
  'yellow cards': { pt: 'Cartões amarelos', es: 'Tarjetas amarillas', en: 'Yellow cards' },
  'yellow card': { pt: 'Cartões amarelos', es: 'Tarjetas amarillas', en: 'Yellow cards' },
  suspended: { pt: 'Suspenso', es: 'Suspendido', en: 'Suspended' },
  suspension: { pt: 'Suspenso', es: 'Suspendido', en: 'Suspended' },
  illness: { pt: 'Doença', es: 'Enfermedad', en: 'Illness' },
  ill: { pt: 'Doença', es: 'Enfermedad', en: 'Illness' },
  virus: { pt: 'Virose', es: 'Virus', en: 'Virus' },
  injury: { pt: 'Lesão', es: 'Lesión', en: 'Injury' },
  knock: { pt: 'Pancada', es: 'Golpe', en: 'Knock' },
  'muscle injury': { pt: 'Lesão muscular', es: 'Lesión muscular', en: 'Muscle injury' },
  'hamstring injury': {
    pt: 'Lesão na coxa (posterior)',
    es: 'Lesión en el isquiotibial',
    en: 'Hamstring injury',
  },
  'thigh injury': { pt: 'Lesão na coxa', es: 'Lesión en el muslo', en: 'Thigh injury' },
  'knee injury': { pt: 'Lesão no joelho', es: 'Lesión en la rodilla', en: 'Knee injury' },
  'ankle injury': { pt: 'Lesão no tornozelo', es: 'Lesión en el tobillo', en: 'Ankle injury' },
  'calf injury': { pt: 'Lesão na panturrilha', es: 'Lesión en el gemelo', en: 'Calf injury' },
  'groin injury': { pt: 'Lesão na virilha', es: 'Lesión en la ingle', en: 'Groin injury' },
  'foot injury': { pt: 'Lesão no pé', es: 'Lesión en el pie', en: 'Foot injury' },
  'back injury': { pt: 'Lesão nas costas', es: 'Lesión de espalda', en: 'Back injury' },
  'hip injury': { pt: 'Lesão no quadril', es: 'Lesión de cadera', en: 'Hip injury' },
  'shoulder injury': { pt: 'Lesão no ombro', es: 'Lesión en el hombro', en: 'Shoulder injury' },
  'head injury': { pt: 'Lesão na cabeça', es: 'Lesión en la cabeza', en: 'Head injury' },
  'achilles tendon injury': {
    pt: 'Lesão no tendão de Aquiles',
    es: 'Lesión en el tendón de Aquiles',
    en: 'Achilles tendon injury',
  },
  'adductor injury': { pt: 'Lesão no adutor', es: 'Lesión en el aductor', en: 'Adductor injury' },
  'abdominal injury': { pt: 'Lesão abdominal', es: 'Lesión abdominal', en: 'Abdominal injury' },
  'cruciate ligament injury': {
    pt: 'Lesão no ligamento cruzado',
    es: 'Lesión del ligamento cruzado',
    en: 'Cruciate ligament injury',
  },
  'knee ligament injury': {
    pt: 'Lesão no ligamento do joelho',
    es: 'Lesión de ligamento de rodilla',
    en: 'Knee ligament injury',
  },
  'ligament injury': { pt: 'Lesão ligamentar', es: 'Lesión de ligamentos', en: 'Ligament injury' },
  'meniscus injury': { pt: 'Lesão no menisco', es: 'Lesión de menisco', en: 'Meniscus injury' },
  concussion: { pt: 'Concussão', es: 'Conmoción cerebral', en: 'Concussion' },
  'broken leg': { pt: 'Fratura na perna', es: 'Fractura de pierna', en: 'Broken leg' },
  'broken arm': { pt: 'Fratura no braço', es: 'Fractura de brazo', en: 'Broken arm' },
  'broken ankle': { pt: 'Fratura no tornozelo', es: 'Fractura de tobillo', en: 'Broken ankle' },
  'broken foot': { pt: 'Fratura no pé', es: 'Fractura de pie', en: 'Broken foot' },
  'broken toe': { pt: 'Fratura no dedo do pé', es: 'Fractura en el dedo del pie', en: 'Broken toe' },
  fracture: { pt: 'Fratura', es: 'Fractura', en: 'Fracture' },
  surgery: { pt: 'Cirurgia', es: 'Cirugía', en: 'Surgery' },
  'lack of fitness': { pt: 'Falta de condição física', es: 'Falta de forma física', en: 'Lack of fitness' },
  'personal reasons': { pt: 'Motivos pessoais', es: 'Motivos personales', en: 'Personal reasons' },
  'coach s decision': { pt: 'Opção do técnico', es: 'Decisión técnica', en: "Coach's decision" },
  'coach decision': { pt: 'Opção do técnico', es: 'Decisión técnica', en: "Coach's decision" },
  'national selection': {
    pt: 'Convocado pela seleção',
    es: 'Convocado por la selección',
    en: 'National team duty',
  },
  'international duty': {
    pt: 'Convocado pela seleção',
    es: 'Convocado por la selección',
    en: 'National team duty',
  },
  'loan agreement': { pt: 'Cláusula de empréstimo', es: 'Cláusula de préstamo', en: 'Loan agreement' },
  inactive: { pt: 'Inativo', es: 'Inactivo', en: 'Inactive' },
};

const CATEGORY_LABEL: Record<SidelinedCategory, Record<Loc, string>> = {
  injury: { pt: 'Lesão', es: 'Lesión', en: 'Injury' },
  suspension: { pt: 'Suspensão', es: 'Suspensión', en: 'Suspension' },
  illness: { pt: 'Doença', es: 'Enfermedad', en: 'Illness' },
  other: { pt: 'Outro motivo', es: 'Otro motivo', en: 'Other reason' },
};

/**
 * Motivo no locale: os textos comuns traduzidos; em inglês, o do fornecedor; nos outros, a categoria
 * (melhor "Lesão" do que um "Metatarsal Stress Fracture" sem tradução num portal em português).
 */
export function sidelinedReasonLabel(reason: string | null | undefined, locale: string): string | null {
  const l = lang(locale);
  const key = plain(reason ?? '');
  if (!key) return null;
  const known = REASONS[key];
  if (known) return known[l];
  if (l === 'en') return (reason ?? '').trim();
  return CATEGORY_LABEL[sidelinedCategory(reason)][l];
}

/** Dias que um afastamento sem fim previsto continua valendo depois do início (evita lesão antiga sem baixa). */
export const OPEN_ENDED_DAYS = 120;

/**
 * Um afastamento do histórico (`person_sidelined`) vale na data `day` (YYYY-MM-DD): começou até lá e termina nela
 * ou depois. Sem fim, vale por `OPEN_ENDED_DAYS` a partir do início; sem início nem fim, não vale.
 */
export function isActiveOn(start: string | null, end: string | null, day: string): boolean {
  if (start && start > day) return false;
  if (end) return end >= day;
  if (!start) return false;
  const limit = new Date(`${start}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + OPEN_ENDED_DAYS);
  return limit.toISOString().slice(0, 10) >= day;
}

/**
 * Junta as listas (a do jogo vence a do histórico para o mesmo jogador, mas herda as datas que faltam) e ordena:
 * fora antes de dúvida, a volta mais distante (ou sem previsão) primeiro, depois o nome (pt-BR).
 */
export function mergeSidelined(
  lists: SidelinedPlayer[][],
  key: (p: SidelinedPlayer) => string = (p) => p.person.id ?? `name:${plain(p.person.name)}`,
): SidelinedPlayer[] {
  const byKey = new Map<string, SidelinedPlayer>();
  for (const list of lists)
    for (const p of list) {
      const k = key(p);
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, p);
        continue;
      }
      const [win, lose] = prev.source === 'match' || p.source !== 'match' ? [prev, p] : [p, prev];
      byKey.set(k, {
        ...win,
        since: win.since ?? lose.since,
        until: win.until ?? lose.until,
        position: win.position ?? lose.position,
        number: win.number ?? lose.number,
        person: {
          ...win.person,
          id: win.person.id ?? lose.person.id,
          photo: win.person.photo ?? lose.person.photo,
        },
      });
    }
  const far = '9999-12-31';
  return [...byKey.values()].sort(
    (a, b) =>
      (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) ||
      (b.until ?? far).localeCompare(a.until ?? far) ||
      a.person.name.localeCompare(b.person.name, 'pt-BR'),
  );
}
