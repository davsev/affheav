import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Run pending Drizzle migrations — ONLY when RUN_MIGRATIONS=true is set.
 *
 * This gate prevents accidental schema changes in production.
 * To apply migrations:
 *   RUN_MIGRATIONS=true node -e "require('./dist/migrate').runMigrationsIfEnabled(...)"
 *
 * @param connectionString  PostgreSQL connection URL for the target service schema
 * @param migrationsFolder  Absolute path to the migrations directory for this service
 */
export async function runMigrationsIfEnabled(
  connectionString: string,
  migrationsFolder: string
): Promise<void> {
  if (process.env.RUN_MIGRATIONS !== 'true') {
    console.log('[db] RUN_MIGRATIONS not set — skipping migrations');
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log('[db] Migrations applied successfully');
  } finally {
    await pool.end();
  }
}
