import type { ValidationError } from '@galaxie/runtime-config';

import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';

/** Mensagem da validação de uma flag no idioma da pessoa (servidor e navegador usam a mesma). */
export function validationMessage(t: Dictionary['ops'], error: ValidationError): string {
  const values = (error.values ?? []).join(', ');
  switch (error.code) {
    case 'range':
      if (error.min !== undefined && error.max !== undefined)
        return fill(t.errors.range, { min: error.min, max: error.max });
      return error.min !== undefined
        ? fill(t.errors.min, { min: error.min })
        : fill(t.errors.max, { max: error.max ?? '' });
    case 'enum':
      return fill(t.errors.enum, { values });
    case 'markets':
      return fill(t.errors.markets, { values });
    case 'cron':
      return t.errors.cron;
    case 'shares':
      return fill(t.errors.shares, { sum: error.detail ?? '?' });
    default:
      return t.errors[error.code];
  }
}
