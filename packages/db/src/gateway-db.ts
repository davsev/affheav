import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as gatewaySchema from './schema/gateway.js';
import { featureFlags, type FeatureFlag } from './schema/gateway.js';

export type GatewayDb = ReturnType<typeof makeDb>;

function makeDb(pool: Pool) {
  return drizzle(pool, { schema: gatewaySchema });
}

// Lazy pool — created on first use
let pool: Pool | null = null;
let db: GatewayDb | null = null;

function getDb(connectionString: string): GatewayDb {
  if (!db) {
    pool = new Pool({ connectionString });
    db = makeDb(pool);
  }
  return db;
}

export async function dbGetFlag(connectionString: string, name: string): Promise<boolean> {
  const rows = await getDb(connectionString)
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(eq(featureFlags.name, name))
    .limit(1);
  return rows[0]?.enabled ?? false;
}

export async function dbListFlags(connectionString: string): Promise<FeatureFlag[]> {
  return getDb(connectionString)
    .select()
    .from(featureFlags)
    .orderBy(featureFlags.name);
}

export async function dbSetFlag(
  connectionString: string,
  name: string,
  enabled: boolean
): Promise<FeatureFlag> {
  const updated = await getDb(connectionString)
    .update(featureFlags)
    .set({ enabled, updated_at: new Date() })
    .where(eq(featureFlags.name, name))
    .returning();

  if (!updated[0]) throw new Error(`Flag '${name}' not found`);
  return updated[0];
}
