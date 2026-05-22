// @affiliate/db — Drizzle ORM schema + migration utilities
// Services import schema types and the migration runner from here.

export * from './schema/index.js';
export { runMigrationsIfEnabled } from './migrate.js';
export { dbGetFlag, dbListFlags, dbSetFlag } from './gateway-db.js';
