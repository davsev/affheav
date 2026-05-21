import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { featureFlags, type FeatureFlag } from '@affiliate/db';
import { getCached, setCached, evict } from './cache.js';
import { config } from '../config.js';

// Lazy DB pool — created on first use so startup doesn't fail if DB is unavailable
let pool: Pool | null = null;
function getDb() {
  if (!pool) {
    if (!config.dbUrl) throw new Error('GATEWAY_DATABASE_URL is not set');
    pool = new Pool({ connectionString: config.dbUrl });
  }
  return drizzle(pool);
}

export async function getFlag(name: string): Promise<boolean> {
  const cached = getCached(name);
  if (cached !== undefined) return cached;

  try {
    const db = getDb();
    const rows = await db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.name, name))
      .limit(1);

    const value = rows[0]?.enabled ?? false;
    setCached(name, value);
    return value;
  } catch {
    // DB unavailable — fail open (return false = monolith fallback)
    return false;
  }
}

export async function listFlags(): Promise<FeatureFlag[]> {
  const db = getDb();
  return db.select().from(featureFlags).orderBy(featureFlags.name);
}

export async function setFlag(name: string, enabled: boolean): Promise<FeatureFlag> {
  const db = getDb();
  const updated = await db
    .update(featureFlags)
    .set({ enabled, updated_at: new Date() })
    .where(eq(featureFlags.name, name))
    .returning();

  if (!updated[0]) throw new Error(`Flag '${name}' not found`);

  // Evict cache IMMEDIATELY so next request reads fresh from DB (FLAG-02 immediate effect)
  evict(name);
  return updated[0];
}
