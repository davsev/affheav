import { type FeatureFlag, dbGetFlag, dbListFlags, dbSetFlag } from '@affiliate/db';
import { getCached, setCached, evict } from './cache.js';
import { config } from '../config.js';

function connectionString(): string {
  if (!config.dbUrl) throw new Error('GATEWAY_DATABASE_URL is not set');
  return config.dbUrl;
}

export async function getFlag(name: string): Promise<boolean> {
  const cached = getCached(name);
  if (cached !== undefined) return cached;

  try {
    const value = await dbGetFlag(connectionString(), name);
    setCached(name, value);
    return value;
  } catch {
    // DB unavailable — fail open (return false = monolith fallback)
    return false;
  }
}

export async function listFlags(): Promise<FeatureFlag[]> {
  return dbListFlags(connectionString());
}

export async function setFlag(name: string, enabled: boolean): Promise<FeatureFlag> {
  const updated = await dbSetFlag(connectionString(), name, enabled);

  // Evict cache IMMEDIATELY so next request reads fresh from DB (FLAG-02 immediate effect)
  evict(name);
  return updated;
}
