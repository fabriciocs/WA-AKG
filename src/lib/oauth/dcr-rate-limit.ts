import { isIP } from "node:net";

export const DCR_REGISTRATION_LIMIT = 10;
export const DCR_REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

export interface DcrRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Build a bounded, per-process fixed-window limiter. The production app currently
 * runs as a single process behind its trusted reverse proxy.
 */
export function createDcrRegistrationRateLimiter(options: {
  limit?: number;
  windowMs?: number;
  maxTrackedIps?: number;
} = {}) {
  const limit = options.limit ?? DCR_REGISTRATION_LIMIT;
  const windowMs = options.windowMs ?? DCR_REGISTRATION_WINDOW_MS;
  const maxTrackedIps = options.maxTrackedIps ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (ip: string, now = Date.now()): DcrRateLimitResult => {
    let bucket = buckets.get(ip);
    if (bucket && bucket.resetAt <= now) {
      buckets.delete(ip);
      bucket = undefined;
    }

    if (!bucket) {
      if (buckets.size >= maxTrackedIps) {
        for (const [trackedIp, tracked] of buckets) {
          if (tracked.resetAt <= now) buckets.delete(trackedIp);
        }
      }
      if (buckets.size >= maxTrackedIps) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (bucket.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

const registrationRateLimit = createDcrRegistrationRateLimiter();

/**
 * The public WA-AKG ingress must sanitize X-Forwarded-For before forwarding it.
 * Selecting the first address preserves the originating client through the
 * reverse-proxy chain; invalid or absent addresses share a conservative bucket.
 */
export function trustedProxyClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstAddress = forwardedFor?.split(",", 1)[0]?.trim();
  return firstAddress && isIP(firstAddress) ? firstAddress : "unknown";
}

export function checkDcrRegistrationRateLimit(ip: string, now?: number) {
  return registrationRateLimit(ip, now);
}
