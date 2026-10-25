import type { I18nText } from '@galaxie/db';

/** As nações do Reino Unido têm código próprio (extensão da api-sports); "GB" é o Reino Unido. */
export const UK_NATIONS: Record<string, string> = {
  england: 'GB-ENG',
  scotland: 'GB-SCT',
  wales: 'GB-WLS',
  'northern-ireland': 'GB-NIR',
};

/**
 * Nome do país dos códigos que a api-sports divide entre mais de um nome (GB: as nações do Reino Unido; UA: a
 * Crimeia). O código fica com o nome do país, nunca com o da primeira linha que aparecer ("GB Wales").
 */
const CANONICAL_NAMES: Record<string, I18nText> = {
  GB: { en: 'United Kingdom', 'pt-BR': 'Reino Unido', es: 'Reino Unido' },
  UA: { en: 'Ukraine', 'pt-BR': 'Ucrânia', es: 'Ucrania' },
};

/** Nome do país para gravar no código: o canônico, se o código tiver um; senão o do fornecedor. */
export function canonicalCountryName(code: string, name: I18nText): I18nText {
  return CANONICAL_NAMES[code] ?? name;
}
