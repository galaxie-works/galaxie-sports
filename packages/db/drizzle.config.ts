import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['raw', 'core', 'semantic', 'enrich', 'ops', 'multisport'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://galaxie:galaxie@localhost:5433/galaxie_sports',
  },
  strict: true,
  verbose: true,
});
