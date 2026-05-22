// 5-second in-process TTL cache for feature flag values.
// On setFlag() the key is evicted so the next read fetches fresh from DB.
// This satisfies FLAG-02 "immediate effect within one request cycle."

type CacheEntry = { value: boolean; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5_000;

export function getCached(name: string): boolean | undefined {
  const entry = cache.get(name);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(name); // clean up expired entry
    return undefined;
  }
  return entry.value;
}

export function setCached(name: string, value: boolean): void {
  cache.set(name, { value, expiresAt: Date.now() + TTL_MS });
}

export function evict(name: string): void {
  cache.delete(name);
}

/** Exposed for tests — clear entire cache */
export function clearCache(): void {
  cache.clear();
}
