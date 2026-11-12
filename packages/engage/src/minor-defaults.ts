/**
 * Padrão mais protetivo para menores (#1107, épico #1103). O ECA Digital pede que o produto já comece no modo mais
 * protetivo para quem tem menos de 18 anos. A Galaxie aplica o mesmo padrão em todos os países (mais simples e mais
 * seguro que variar por país), no servidor, para as faixas `13`, `14_15` e `16_17` (e a faixa congelada).
 *
 * O portão de idade (#1106) já fecha os recursos de adulto: contato direto, marketing, conteúdo restrito, Prêmio.
 * Aqui ficam a lista das proteções, com o texto que explica cada uma, e as regras do Perfil que os outros veem.
 * Ao completar 18 (#1110) nada muda sozinho: o torcedor escolhe o que liga.
 */
import { ageBandFloor, type AgeBand } from './country-policy.js';
import type { FanAgeFacts } from './fan-age.js';

export const MINOR_PROTECTION_LOCALES = ['pt-BR', 'es', 'en', 'fr-CA'] as const;
export type MinorProtectionLocale = (typeof MINOR_PROTECTION_LOCALES)[number];

export const MINOR_PROTECTIONS = [
  'private_profile',
  'no_own_photo',
  'no_direct_contact',
  'context_recommendations',
  'no_targeted_ads',
  'country_only_location',
  'no_marketing',
  'no_commercial_behavior_analysis',
] as const;
export type MinorProtection = (typeof MINOR_PROTECTIONS)[number];

export interface MinorProtectionText {
  /** O que a proteção faz. */
  title: string;
  /** O que muda se o responsável desligar (só nas que ele pode desligar, Idade 8, #1111). */
  relaxed: string | null;
}

export interface MinorProtectionDef {
  /** O responsável pode desligar pelo painel dele (Idade 8); as outras valem até os 18 anos. */
  guardianCanRelax: boolean;
  text: Record<MinorProtectionLocale, MinorProtectionText>;
}

export const MINOR_PROTECTION_DEFS: Readonly<Record<MinorProtection, MinorProtectionDef>> = {
  private_profile: {
    guardianCanRelax: true,
    text: {
      'pt-BR': {
        title: 'Os outros torcedores veem só o Apelido. Nível, conquistas e time do coração ficam privados.',
        relaxed: 'Os outros torcedores do mesmo app passam a ver o nível, as conquistas e o time do coração.',
      },
      es: {
        title: 'Los demás hinchas solo ven el apodo. Nivel, logros y equipo del corazón quedan privados.',
        relaxed:
          'Los demás hinchas de la misma app pasan a ver el nivel, los logros y el equipo del corazón.',
      },
      en: {
        title: 'Other fans only see the nickname. Level, badges and favorite team stay private.',
        relaxed: 'Other fans in the same app can see the level, badges and favorite team.',
      },
      'fr-CA': {
        title:
          'Les autres partisans voient seulement le pseudo. Niveau, badges et équipe favorite restent privés.',
        relaxed: "Les autres partisans de la même appli voient le niveau, les badges et l'équipe favorite.",
      },
    },
  },
  no_own_photo: {
    guardianCanRelax: false,
    text: {
      'pt-BR': { title: 'Sem foto própria: o Perfil usa um avatar do catálogo do app.', relaxed: null },
      es: { title: 'Sin foto propia: el perfil usa un avatar del catálogo de la app.', relaxed: null },
      en: { title: "No personal photo: the profile uses an avatar from the app's catalog.", relaxed: null },
      'fr-CA': {
        title: "Pas de photo personnelle : le profil utilise un avatar du catalogue de l'appli.",
        relaxed: null,
      },
    },
  },
  no_direct_contact: {
    guardianCanRelax: false,
    text: {
      'pt-BR': {
        title: 'Sem mensagem privada, menção de desconhecidos ou convite de adultos.',
        relaxed: null,
      },
      es: {
        title: 'Sin mensajes privados, menciones de desconocidos ni invitaciones de adultos.',
        relaxed: null,
      },
      en: {
        title: 'No private messages, mentions from strangers or invitations from adults.',
        relaxed: null,
      },
      'fr-CA': {
        title: "Pas de message privé, de mention par des inconnus ni d'invitation d'adultes.",
        relaxed: null,
      },
    },
  },
  context_recommendations: {
    guardianCanRelax: true,
    text: {
      'pt-BR': {
        title: 'As sugestões vêm só do jogo e do time escolhido, nunca de um perfil de comportamento.',
        relaxed: 'As sugestões passam a considerar o que o torcedor usou no app, sem fins de publicidade.',
      },
      es: {
        title:
          'Las sugerencias salen solo del partido y del equipo elegido, nunca de un perfil de comportamiento.',
        relaxed:
          'Las sugerencias pasan a considerar lo que el hincha usó en la app, sin fines publicitarios.',
      },
      en: {
        title: 'Suggestions come only from the game and the chosen team, never from a behavior profile.',
        relaxed: 'Suggestions also take into account what the fan used in the app, never for advertising.',
      },
      'fr-CA': {
        title:
          "Les suggestions viennent seulement du match et de l'équipe choisie, jamais d'un profil de comportement.",
        relaxed:
          "Les suggestions tiennent aussi compte de ce que le partisan a utilisé dans l'appli, sans publicité.",
      },
    },
  },
  no_targeted_ads: {
    guardianCanRelax: false,
    text: {
      'pt-BR': {
        title: 'Sem publicidade direcionada nem perfil para anúncios. Patrocinador aparece só como marca.',
        relaxed: null,
      },
      es: {
        title: 'Sin publicidad dirigida ni perfil para anuncios. El patrocinador aparece solo como marca.',
        relaxed: null,
      },
      en: { title: 'No targeted ads or ad profiling. Sponsors only appear as a brand.', relaxed: null },
      'fr-CA': {
        title:
          'Pas de publicité ciblée ni de profilage publicitaire. Le commanditaire apparaît seulement comme marque.',
        relaxed: null,
      },
    },
  },
  country_only_location: {
    guardianCanRelax: false,
    text: {
      'pt-BR': { title: 'A única localização usada é o país informado pelo app.', relaxed: null },
      es: { title: 'La única ubicación que se usa es el país que informa la app.', relaxed: null },
      en: { title: 'The only location used is the country the app provides.', relaxed: null },
      'fr-CA': { title: "La seule localisation utilisée est le pays fourni par l'appli.", relaxed: null },
    },
  },
  no_marketing: {
    guardianCanRelax: false,
    text: {
      'pt-BR': {
        title: 'Sem e-mail, push ou SMS de marketing até os 18 anos, mesmo com opt-in.',
        relaxed: null,
      },
      es: {
        title: 'Sin correo, push ni SMS de marketing hasta los 18 años, aunque haya opt-in.',
        relaxed: null,
      },
      en: { title: 'No marketing email, push or SMS until 18, even with opt-in.', relaxed: null },
      'fr-CA': {
        title: 'Pas de courriel, de notification ni de texto marketing avant 18 ans, même avec consentement.',
        relaxed: null,
      },
    },
  },
  no_commercial_behavior_analysis: {
    guardianCanRelax: false,
    text: {
      'pt-BR': {
        title: 'A Cosmos não analisa emoção nem comportamento de menor para fins comerciais.',
        relaxed: null,
      },
      es: {
        title: 'Cosmos no analiza emociones ni comportamiento de menores con fines comerciales.',
        relaxed: null,
      },
      en: {
        title: "Cosmos never analyzes a minor's emotions or behavior for commercial purposes.",
        relaxed: null,
      },
      'fr-CA': {
        title: "Cosmos n'analyse jamais les émotions ni le comportement d'un mineur à des fins commerciales.",
        relaxed: null,
      },
    },
  },
};

/** O padrão protetivo vale? Menor de 18, ou faixa congelada depois de descer de adulto. */
export function minorDefaultsApply(fan: Pick<FanAgeFacts, 'band' | 'frozen'>): boolean {
  return fan.frozen || ageBandFloor(fan.band) < 18;
}

export const isMinorBand = (band: AgeBand): boolean => ageBandFloor(band) < 18;

export type PublicVisibility = 'public' | 'private';
export type VisibilityFields = 'avatar' | 'favorite_team' | 'level' | 'badges';
export type FanVisibilityMap = Partial<Record<VisibilityFields, PublicVisibility>>;

const ALL_PRIVATE: Readonly<Required<FanVisibilityMap>> = {
  avatar: 'private',
  favorite_team: 'private',
  level: 'private',
  badges: 'private',
};

/**
 * A visibilidade que vale: para menor, tudo privado, seja o que for que está gravado (#1107). Para adulto, o que ele
 * escolheu. O responsável liberar o Perfil (Idade 8) entra aqui quando chegar.
 */
export function effectiveVisibility(
  fan: Pick<FanAgeFacts, 'band' | 'frozen'>,
  stored: FanVisibilityMap,
): FanVisibilityMap {
  return minorDefaultsApply(fan) ? { ...ALL_PRIVATE } : stored;
}

/** Idioma das proteções: o do torcedor se houver texto nele (`es-AR` vale `es`), senão o pt-BR. */
export function minorProtectionLocale(locale: string): MinorProtectionLocale {
  if ((MINOR_PROTECTION_LOCALES as readonly string[]).includes(locale))
    return locale as MinorProtectionLocale;
  const lang = locale.split('-')[0]!.toLowerCase();
  if (lang === 'fr') return 'fr-CA';
  if (lang === 'es' || lang === 'en') return lang;
  return 'pt-BR';
}

/** As proteções, com o texto no idioma do torcedor, na ordem da lista. */
export function minorProtections(
  locale: string,
): ({ id: MinorProtection; guardianCanRelax: boolean } & MinorProtectionText)[] {
  const l = minorProtectionLocale(locale);
  return MINOR_PROTECTIONS.map((id) => ({
    id,
    guardianCanRelax: MINOR_PROTECTION_DEFS[id].guardianCanRelax,
    ...MINOR_PROTECTION_DEFS[id].text[l],
  }));
}
