type Entry = { count: number; resetAt: number };

const globalStore = globalThis as unknown as { authRateLimitStore?: Map<string, Entry> };
const store = globalStore.authRateLimitStore ?? new Map<string, Entry>();

if (!globalStore.authRateLimitStore) {
  globalStore.authRateLimitStore = store;
}

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  store.set(key, current);
  return { allowed: true, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
}
