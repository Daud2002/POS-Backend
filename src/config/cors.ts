import { DeploymentMode } from './deployment';

/** Origins the cloud API answers: the Vercel web app and local development. */
export const CLOUD_ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:3000',
  'https://tapntrade.store',
  'https://pos.tapntrade.store',
];

/**
 * Whether a browser origin may call this API.
 *
 * A store server serves the web app itself, so its pages arrive from whatever
 * address the device used to reach the cashier PC: https://localhost on the
 * PC, https://192.168.1.20 from a kitchen tablet, or the PC's .local name.
 * Browsers send Origin even on same-origin POSTs, so the cloud's fixed list
 * would reject every write. The addresses are not knowable in advance (DHCP
 * hands them out), so the store server accepts loopback, private-range and
 * .local hosts: the only origins a page on the shop's own network can have.
 * Public origins stay rejected, which is what stops a random website from
 * driving the API through a staff member's browser.
 */
export function isAllowedOrigin(origin: string, mode: DeploymentMode): boolean {
  if (mode === 'cloud') return CLOUD_ALLOWED_ORIGINS.includes(origin);

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return isLocalNetworkHost(url.hostname);
}

/** Loopback, RFC 1918, link-local and mDNS (.local) hosts. */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (host.endsWith('.local')) return true;

  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets;

  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
