import { sql } from 'drizzle-orm';
import { jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

/** PK própria em UUID v7 (ordenável por tempo), gerada pela função criada na migration 0000. */
export const pkUuidV7 = () =>
  uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`);

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Texto multilíngue: { "pt-BR": "...", "es-AR": "..." } */
export type I18nText = Partial<Record<Locale, string>>;
export const i18n = (name: string) => jsonb(name).$type<I18nText>();

export const LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
  'es-PY',
  'es-BO',
  'es-VE',
  'es',
  'en',
] as const;
export type Locale = (typeof LOCALES)[number];

export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
