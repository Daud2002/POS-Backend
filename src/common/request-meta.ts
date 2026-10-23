/**
 * Who is on the other end of a request, for audit rows and rate limits.
 *
 * Production sits behind a proxy that forwards `/api/*`, so `req.ip` alone is
 * the proxy's address for every client. The first hop of `x-forwarded-for`
 * is the real one (later hops are the proxies themselves).
 */

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export function clientIp(req: RequestLike): string | null {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  const ip = String(first ?? req.ip ?? req.socket?.remoteAddress ?? '').trim();
  return ip ? ip.slice(0, 64) : null;
}

export function userAgentOf(req: RequestLike): string | null {
  const header = req.headers?.['user-agent'];
  const value = Array.isArray(header) ? header[0] : header;
  return value ? String(value).slice(0, 255) : null;
}
