import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as forge from 'node-forge';
import { ensureTls, fingerprint } from './tls';

describe('store server TLS', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'tnt-tls-'));
    process.env.TAPNTRADE_DATA_DIR = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.TAPNTRADE_DATA_DIR;
  });

  const hosts = { ips: ['127.0.0.1', '192.168.1.20'], names: ['localhost', 'till.local'] };

  it('issues a server certificate for every local address, signed by the shop CA', () => {
    const tls = ensureTls(hosts);
    const leaf = forge.pki.certificateFromPem(tls.cert);
    const ca = forge.pki.certificateFromPem(tls.caCertPem);

    expect(ca.verify(leaf)).toBe(true);
    const san = (leaf.getExtension('subjectAltName') as any).altNames.map((a: any) => a.ip ?? a.value);
    expect(san).toEqual(expect.arrayContaining(['localhost', 'till.local', '127.0.0.1', '192.168.1.20']));
    expect(tls.caSha256).toBe(fingerprint(tls.caCertPem));
  });

  it('limits the CA to the shop network', () => {
    const ca = forge.pki.certificateFromPem(ensureTls(hosts).caCertPem);
    const constraints = ca.extensions.find((e: any) => e.id === '2.5.29.30');
    expect(constraints?.critical).toBe(true);
  });

  it('keeps the certificate until the address changes, then re-issues it with the same CA', () => {
    const first = ensureTls(hosts);
    expect(ensureTls(hosts).reissued).toBe(false);

    const moved = ensureTls({ ...hosts, ips: ['127.0.0.1', '192.168.1.37'] });
    expect(moved.reissued).toBe(true);
    expect(moved.caSha256).toBe(first.caSha256);
  });
});
