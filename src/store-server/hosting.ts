import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { DataSource } from 'typeorm';
import { StoreSyncService } from '../sync/store/store-sync.service';
import { TlsFiles, localHosts, mobileConfig } from './tls';

/**
 * How a store server presents itself on the shop's network.
 *
 * One Express app answers on two ports:
 * - HTTPS (443): the API, the realtime socket and the web app itself, so a
 *   tablet needs nothing from the internet to open TapNtrade.
 * - HTTP (80): only the setup page and the certificate downloads. A device
 *   cannot trust HTTPS before it has the shop's certificate, so this is how
 *   it gets it. Everything else is redirected to HTTPS.
 */

export const httpsPort = () => Number(process.env.HTTPS_PORT || 443);
export const httpPort = () => Number(process.env.HTTP_PORT || 80);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = (req: Request) => LOOPBACK.has(req.socket.remoteAddress ?? '');
const isHttps = (req: Request) => (req.socket as { encrypted?: boolean }).encrypted === true;

/**
 * Cloud-only features. A store server holds one store; registering accounts,
 * impersonating owners, the platform's audit log and subscriptions belong
 * to the cloud. Customers share this Wi-Fi, so these are not just hidden
 * but gone.
 */
const CLOUD_ONLY: { method?: string; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/api\/auth\/register\/?$/ },
  { pattern: /^\/api\/auth\/impersonation-links/ },
  { pattern: /^\/api\/audit-logs/ },
  { pattern: /^\/api\/reports\/platform-overview/ },
  { pattern: /^\/api\/stores\/[^/]+\/subscription/ },
  { method: 'POST', pattern: /^\/api\/stores\/?$/ },
  { method: 'DELETE', pattern: /^\/api\/stores\/[^/]+\/?$/ },
  { pattern: /^\/api\/users(\/|$)/ },
];

/** Must be added before Nest registers its routes (i.e. before app.init / listen). */
export function guardStoreServerRoutes(app: NestExpressApplication) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const blocked = CLOUD_ONLY.some((r) => (!r.method || r.method === req.method) && r.pattern.test(req.path));
    if (blocked) return res.status(404).json({ statusCode: 404, message: 'Not available on a store server' });
    next();
  });

  // Plain HTTP carries only the setup page; the cashier PC itself may also
  // reach the pairing endpoint before its browser trusts the certificate.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isHttps(req) || req.path.startsWith('/setup')) return next();
    if (isLoopback(req) && req.path.startsWith('/api/local/')) return next();
    const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
    const port = httpsPort() === 443 ? '' : `:${httpsPort()}`;
    res.redirect(308, `https://${host}${port}${req.originalUrl}`);
  });

  app.use(loginRateLimit());
}

/**
 * Ten sign-in attempts a minute per device. The shop Wi-Fi is shared with
 * customers, and without this a phone on it could guess staff passwords as
 * fast as bcrypt answers.
 */
function loginRateLimit() {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || !/^\/api\/auth\/(login|refresh)\/?$/.test(req.path)) return next();
    const key = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 10) {
      return res.status(429).json({ statusCode: 429, message: 'Too many attempts. Wait a minute and try again.' });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

/**
 * Serves the web app built for a store server (`npm run build:store` in
 * POS-Frontend), with every unknown non-API path answered by index.html so
 * the app's own routes work on reload.
 */
export function serveWebApp(app: NestExpressApplication) {
  const dir = process.env.WEB_DIST_DIR || path.join(process.cwd(), 'web');
  const index = path.join(dir, 'index.html');
  if (!existsSync(index)) return null;

  app.useStaticAssets(dir, { index: false, maxAge: '1h' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || /^\/(api|socket\.io|realtime|setup)(\/|$)/.test(req.path)) return next();
    if (!req.accepts('html')) return next();
    res.sendFile(index);
  });
  return dir;
}

/** The setup page and certificate downloads, on both ports. */
export function setupRoutes(app: NestExpressApplication, tls: () => TlsFiles) {
  const sync = app.get(StoreSyncService);
  const db = app.get(DataSource);

  app.use('/setup/ca.crt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="tapntrade-store-ca.crt"');
    res.send(tls().caCertPem);
  });

  app.use('/setup/ca.mobileconfig', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="tapntrade-store.mobileconfig"');
    res.send(mobileConfig(tls().caCertPem, (await storeName(db)) ?? 'TapNtrade store server'));
  });

  app.use('/setup', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || (req.path !== '/' && req.path !== '')) return next();
    const status = await sync.status();
    const name = await storeName(db);
    const lanIp = preferredLanIp();
    const qrTarget = lanIp ? setupUrl(lanIp, status.storeId, tls().caSha256) : null;
    const qrSvg = qrTarget ? await QRCode.toString(qrTarget, { type: 'svg', margin: 1, width: 220 }) : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(setupPage({ status, name, lanIp, qrSvg, caSha256: tls().caSha256, onThisPc: isLoopback(req) }));
  });
}

/** What the QR on the setup page encodes. The mobile app parses the same URL (src/lib/connection/qr.ts). */
export function setupUrl(ip: string, storeId: string | null, caSha256: string): string {
  const port = httpPort() === 80 ? '' : `:${httpPort()}`;
  const params = new URLSearchParams({ ca: caSha256 });
  if (storeId) params.set('store', storeId);
  if (httpsPort() !== 443) params.set('port', String(httpsPort()));
  return `http://${ip}${port}/setup?${params}`;
}

/** A private LAN address phones can reach, preferring the usual home-router ranges over link-local. */
function preferredLanIp(): string | null {
  const ips = localHosts().ips.filter((ip) => ip !== '127.0.0.1');
  return ips.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip)) ?? ips[0] ?? null;
}

async function storeName(db: DataSource): Promise<string | null> {
  try {
    const [row] = await db.query(`SELECT name FROM stores LIMIT 1`);
    return row?.name ?? null;
  } catch {
    return null;
  }
}

/** The plain HTTP listener for setup; same Express app, so the same routes. */
export function startHttpListener(app: NestExpressApplication): http.Server {
  const server = http.createServer(app.getHttpAdapter().getInstance());
  server.listen(httpPort());
  return server;
}

// ------------------------------------------------------------------- page

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const pairs = (hex: string) => hex.toUpperCase().match(/.{2}/g)?.join(':') ?? hex;

function setupPage(p: {
  status: Awaited<ReturnType<StoreSyncService['status']>>;
  name: string | null;
  lanIp: string | null;
  qrSvg: string;
  caSha256: string;
  onThisPc: boolean;
}): string {
  const { status } = p;
  const appUrl = p.onThisPc ? 'https://localhost' : p.lanIp ? `https://${p.lanIp}` : '';

  const pairing = !status.paired
    ? p.onThisPc
      ? `<section>
          <h2>1. Link this PC to your store</h2>
          <p>In TapNtrade on the cloud (pos.tapntrade.store), open <b>Settings → Store Server → Generate pairing code</b>, then type the code here.</p>
          <form id="pair"><input name="code" placeholder="ABCD-EFGH" autocomplete="off" maxlength="9" required>
          <button>Link</button></form><p id="pair-msg" class="muted"></p>
        </section>`
      : `<section><h2>Not linked yet</h2><p>Open this page on the store server PC itself to link it to your store.</p></section>`
    : `<section>
        <h2>${esc(p.name ?? 'Store')}</h2>
        <p>${
          status.writable
            ? '✅ Taking orders. Works with or without internet.'
            : '⏳ Linked. Now press <b>Activate</b> in cloud <b>Settings → Store Server</b>.'
        }</p>
        <p class="muted">Last sync with the cloud: ${status.lastSyncAt ? esc(new Date(status.lastSyncAt).toLocaleString()) : 'not yet'}${
          status.pendingChanges ? ` · ${status.pendingChanges} changes waiting` : ''
        }${status.lastSyncError ? ` · ${esc(status.lastSyncError)}` : ''}</p>
        ${appUrl ? `<p><a class="button" href="${esc(appUrl)}">Open TapNtrade</a></p>` : ''}
      </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TapNtrade store server</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --muted:#666; --bg:#fafafa; --card:#fff; --line:#e3e3e3; --accent:#0f766e; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --muted:#aaa; --bg:#121212; --card:#1d1d1d; --line:#333; } }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:640px; margin:0 auto; padding:16px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin:12px 0; }
  h1 { font-size:22px; margin:8px 0 } h2 { font-size:18px; margin:0 0 8px }
  .muted { color:var(--muted); font-size:14px } code { word-break:break-all; font-size:13px }
  input { font-size:20px; padding:8px; width:11ch; letter-spacing:2px; text-transform:uppercase }
  button, .button { display:inline-block; font-size:16px; padding:9px 16px; border-radius:8px; border:0; background:var(--accent); color:#fff; text-decoration:none; cursor:pointer }
  .qr svg { width:220px; height:220px; background:#fff; padding:6px; border-radius:8px }
  ol { padding-left:20px }
</style></head>
<body><main>
<h1>TapNtrade store server</h1>
${pairing}
<section>
  <h2>${status.paired ? '' : '2. '}Connect phones and tablets</h2>
  ${p.qrSvg ? `<div class="qr">${p.qrSvg}</div><p class="muted">Scan with the TapNtrade app (Connect to store server), or with the phone camera to open this page.</p>` : ''}
  <p><b>Once per device, install the shop certificate:</b></p>
  <ol>
    <li><b>iPhone / iPad:</b> <a href="/setup/ca.mobileconfig">download the profile</a>, then Settings → General → VPN &amp; Device Management → install it, then Settings → General → About → Certificate Trust Settings → turn it on.</li>
    <li><b>Android:</b> <a href="/setup/ca.crt">download the certificate</a>, then Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate.</li>
    <li><b>Windows / other browsers:</b> <a href="/setup/ca.crt">download the certificate</a> and add it to the trusted root certificates.</li>
  </ol>
  <p class="muted">Check the fingerprint matches what the app shows:<br><code>${esc(pairs(p.caSha256))}</code></p>
  ${p.lanIp ? `<p class="muted">Address on this Wi-Fi: <b>https://${esc(p.lanIp)}${httpsPort() === 443 ? '' : ':' + httpsPort()}</b></p>` : ''}
</section>
</main>
<script>
  const form = document.getElementById('pair');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pair-msg');
    msg.textContent = 'Linking and copying your store… this can take a minute.';
    try {
      const res = await fetch('/api/local/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: form.code.value }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not link');
      msg.textContent = 'Linked to ' + body.storeName + '. Reloading…';
      setTimeout(() => location.reload(), 1200);
    } catch (err) { msg.textContent = err.message; }
  });
</script>
</body></html>`;
}
