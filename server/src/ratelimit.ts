import type { Storage } from './storage/types';

/**
 * Fixed-window rate limit on Storage counters.
 * Returns true when the request is allowed.
 */
export async function allowRate(
  store: Storage,
  scope: string,
  subject: string,
  limit: number,
  windowMs = 60 * 60 * 1000,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = now - (now % windowMs);
  const key = `${scope}:${subject}:${windowStart}`;
  const count = await store.bumpRate(key, windowStart);
  return count <= limit;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
