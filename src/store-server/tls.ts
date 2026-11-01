import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as forge from 'node-forge';

/**
 * HTTPS for a store server, from the shop's own certificate authority.
 *
 * Every shop gets its own CA, generated on its PC; the private key never
 * leaves it. Devices in that shop trust that CA once (scan the QR, install).
 * One TapNtrade-wide CA would have been simpler, but most shops use the same
 * addresses (192.168.1.x): a certificate taken from one shop's PC would then
 * impersonate another shop's server on its Wi-Fi, which customers share.
 *
 * The CA is name-constrained to local addresses (private IP ranges, .local,
 * localhost). Phones trust it as a root, so without the constraint a stolen
 * key could mint a certificate for any website; with it, only for the shop's
 * own network.
 *
 * The server certificate covers localhost and every current LAN address. When
 * DHCP hands the PC a new address, a new certificate is issued here, offline.
 */

export interface TlsFiles {
  key: string;
  cert: string;
  caCertPem: string;
  /** SHA-256 of the CA certificate, lowercase hex: what devices compare when installing it. */
  caSha256: string;
}

const LEAF_DAYS = 397; // the longest any browser accepts for a server certificate
const CA_YEARS = 20;

export const dataDir = () => process.env.TAPNTRADE_DATA_DIR || path.join(process.cwd(), '.store-data');
const keysDir = () => path.join(dataDir(), 'keys');
const file = (name: string) => path.join(keysDir(), name);

/** Loads the shop's TLS material, creating the CA on first run and re-issuing the server certificate when needed. */
export function ensureTls(hosts: { ips: string[]; names: string[] }): TlsFiles & { reissued: boolean } {
  mkdirSync(keysDir(), { recursive: true, mode: 0o700 });
  const ca = loadOrCreateCa();

  let reissued = false;
  if (!leafCovers(hosts)) {
    issueLeaf(ca, hosts);
    reissued = true;
  }
  return {
    key: readFileSync(file('server.key'), 'utf8'),
    cert: readFileSync(file('server.crt'), 'utf8') + ca.pem,
    caCertPem: ca.pem,
    caSha256: fingerprint(ca.pem),
    reissued,
  };
}

export function fingerprint(certPem: string): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes();
  return createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
}

/** IPv4 addresses of this PC on its networks, and the names it answers to. */
export function localHosts(): { ips: string[]; names: string[] } {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  const host = os.hostname().replace(/\.local$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return { ips: ['127.0.0.1', ...ips], names: ['localhost', `${host}.local`] };
}

function newKeyPair() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const key = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  return { pem: privateKey, key, publicKey: forge.pki.setRsaPublicKey(key.n, key.e) };
}

const serial = () => '01' + randomBytes(15).toString('hex'); // positive, 128 bits of randomness

function loadOrCreateCa(): { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate; pem: string } {
  if (existsSync(file('ca.key')) && existsSync(file('ca.crt'))) {
    const pem = readFileSync(file('ca.crt'), 'utf8');
    return {
      key: forge.pki.privateKeyFromPem(readFileSync(file('ca.key'), 'utf8')) as forge.pki.rsa.PrivateKey,
      cert: forge.pki.certificateFromPem(pem),
      pem,
    };
  }

  const pair = newKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + CA_YEARS * 365 * 86_400_000);
  const subject = [
    { name: 'commonName', value: `TapNtrade Store Server CA (${os.hostname().slice(0, 40)})` },
    { name: 'organizationName', value: 'TapNtrade store server' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { id: '2.5.29.30', critical: true, value: localOnlyNameConstraints() },
  ]);
  cert.sign(pair.key, forge.md.sha256.create());

  const pem = forge.pki.certificateToPem(cert);
  writeFileSync(file('ca.key'), pair.pem, { mode: 0o600 });
  writeFileSync(file('ca.crt'), pem);
  return { key: pair.key, cert, pem };
}

/**
 * NameConstraints (RFC 5280 §4.2.1.10) permitting only the shop network:
 * the private IPv4 ranges, loopback, link-local, and DNS names under .local
 * and localhost.
 */
function localOnlyNameConstraints(): forge.asn1.Asn1 {
  const { asn1 } = forge;
  const ip = (cidr: [number[], number[]]) =>
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 7, false, String.fromCharCode(...cidr[0], ...cidr[1]));
  const dns = (name: string) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, name);
  const subtree = (generalName: forge.asn1.Asn1) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [generalName]);

  const permitted = [
    ip([[10, 0, 0, 0], [255, 0, 0, 0]]),
    ip([[172, 16, 0, 0], [255, 240, 0, 0]]),
    ip([[192, 168, 0, 0], [255, 255, 0, 0]]),
    ip([[169, 254, 0, 0], [255, 255, 0, 0]]),
    ip([[127, 0, 0, 0], [255, 0, 0, 0]]),
    dns('local'),
    dns('localhost'),
  ].map(subtree);

  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, permitted),
  ]);
}

/** True when the current server certificate names every wanted host and has more than half its life left. */
function leafCovers(hosts: { ips: string[]; names: string[] }): boolean {
  if (!existsSync(file('server.crt')) || !existsSync(file('server.key'))) return false;
  try {
    const cert = forge.pki.certificateFromPem(readFileSync(file('server.crt'), 'utf8'));
    const san = (cert.getExtension('subjectAltName') as any)?.altNames ?? [];
    const has = (type: number, value: string) => san.some((a: any) => a.type === type && (a.ip ?? a.value) === value);
    const allNamed = hosts.ips.every((ip) => has(7, ip)) && hosts.names.every((n) => has(2, n));
    const life = cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime();
    const left = cert.validity.notAfter.getTime() - Date.now();
    return allNamed && left > life / 2;
  } catch {
    return false;
  }
}

function issueLeaf(ca: { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate }, hosts: { ips: string[]; names: string[] }) {
  const pair = newKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + LEAF_DAYS * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: hosts.names[1] ?? 'localhost' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.cert.generateSubjectKeyIdentifier().getBytes() },
    {
      name: 'subjectAltName',
      altNames: [
        ...hosts.names.map((value) => ({ type: 2, value })),
        ...[...new Set(hosts.ips)].map((ip) => ({ type: 7, ip })),
      ],
    },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  writeFileSync(file('server.key'), pair.pem, { mode: 0o600 });
  writeFileSync(file('server.crt'), forge.pki.certificateToPem(cert));
}

/** An iOS configuration profile that installs the shop's CA. iPhones need this, not a bare .crt. */
export function mobileConfig(caCertPem: string, storeLabel: string): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(caCertPem))).getBytes();
  const b64 = Buffer.from(der, 'binary').toString('base64');
  const id = fingerprint(caCertPem).slice(0, 12);
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key><string>tapntrade-store-ca.cer</string>
      <key>PayloadContent</key><data>${b64}</data>
      <key>PayloadDisplayName</key><string>${esc(storeLabel)} certificate</string>
      <key>PayloadIdentifier</key><string>store.tapntrade.server.ca.${id}</string>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadUUID</key><string>${uuidFrom(id + 'cert')}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>${esc(storeLabel)} (TapNtrade)</string>
  <key>PayloadIdentifier</key><string>store.tapntrade.server.${id}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuidFrom(id + 'profile')}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;
}

/** A stable UUID-shaped id derived from `seed`, so re-downloading the profile replaces it rather than duplicating. */
function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}
