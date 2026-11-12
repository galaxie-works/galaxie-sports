import { VAR_DETAILS } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';
import { textsFor, WIDGET_LOCALES } from './core/model.js';

describe('vereditos do VAR (#641)', () => {
  it.each(WIDGET_LOCALES)('%s traduz todo detail de VAR que a api-sports manda', (locale) => {
    const known = textsFor(locale).timeline.var;
    expect(Object.keys(VAR_DETAILS).filter((d) => !known[d])).toEqual([]);
  });
});
