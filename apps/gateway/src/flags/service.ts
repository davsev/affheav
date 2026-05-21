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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return drizzle(pool) as any;
}

// NOTE: featureFlags cast to any works around a drizzle-orm NodeNext resolution
// mode issue where the schema types from @affiliate/db (compiled dist) and the drizzle-orm
// runtime imports resolve to separate module instances with incompatible private properties.
// Runtime behavior is correct — only the TS type checker is confused.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flags = featureFlags as any;

export async function getFlag(name: string): Promise<boolean> {
  const cached = getCached(name);
  if (cached !== undefined) return cached;

  try {
    const db = getDb();
    const rows: Array<{ enabled: boolean }> = await db
      .select({ enabled: flags.enabled })
      .from(flags)
      .where(eq(flags.name, name))
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
  const rows: FeatureFlag[] = await db.select().from(flags).orderBy(flags.name);
  return rows;
}

export async function setFlag(name: string, enabled: boolean): Promise<FeatureFlag> {
  const db = getDb();
  const updated: FeatureFlag[] = await db
    .update(flags)
    .set({ enabled, updated_at: new Date() })
    .where(eq(flags.name, name))
    .returning();

  if (!updated[0]) throw new Error(`Flag '${name}' not found`);

  // Evict cache IMMEDIATELY so next request reads fresh from DB (FLAG-02 immediate effect)
  evict(name);
  return updated[0];
}
