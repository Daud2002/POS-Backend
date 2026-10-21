import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, createSign, KeyObject } from 'crypto';

/**
 * Signs QZ Tray requests so a cashier station prints with NO "Allow" prompt.
 *
 * QZ Tray shows its permission dialog for any request it cannot trace to a
 * certificate it trusts. The web app used to send none at all, so every
 * station was asked again after each browser restart. QZ sells a certificate
 * that its built-in root trusts; this is the free equivalent: we are our own
 * root. Each station carries `override.crt` (our root CA, see ../../../qz-tray/
 * README.md), the browser presents the signing certificate that root issued,
 * and every request is signed here with the matching private key. QZ Tray
 * verifies the chain and the signature and prints silently.
 *
 * The private key lives ONLY on the server, as an environment variable. Signing
 * client-side would ship the key to every browser, and whoever holds it can
 * print silently on every station that trusts our root.
 *
 * Both values are optional: a deployment without them still prints, it just
 * gets the prompt back. The frontend treats the 503 from here as "unsigned".
 */
@Injectable()
export class QzSigningService {
  private readonly logger = new Logger(QzSigningService.name);
  private key: KeyObject | null = null;
  private cert: string | null = null;
  private loaded = false;

  /** True when a key and certificate were read from the environment. */
  get configured(): boolean {
    this.load();
    return this.key !== null && this.cert !== null;
  }

  /** The PEM certificate the browser hands to QZ Tray. */
  certificate(): string {
    this.load();
    if (!this.cert) throw this.notConfigured();
    return this.cert;
  }

  /**
   * Base64 RSA-SHA512 signature over `data`, exactly as QZ Tray verifies it.
   *
   * `data` is the SHA-256 hex digest that qz-tray.js computes over the call;
   * it is signed as-is. The algorithm must match what the frontend declares
   * with `qz.security.setSignatureAlgorithm('SHA512')`.
   */
  sign(data: string): string {
    this.load();
    if (!this.key) throw this.notConfigured();
    const signer = createSign('SHA512');
    signer.update(data, 'utf8');
    return signer.sign(this.key, 'base64');
  }

  private notConfigured() {
    return new ServiceUnavailableException(
      'Silent printing is not configured on this server (QZ_SIGNING_KEY / QZ_SIGNING_CERT).',
    );
  }

  /**
   * Reads the pair once, lazily, so a misconfigured key logs on first use
   * rather than refusing to boot the whole API over a print-only feature.
   */
  private load() {
    if (this.loaded) return;
    this.loaded = true;

    const certPem = decodePem(process.env.QZ_SIGNING_CERT);
    const keyPem = decodePem(process.env.QZ_SIGNING_KEY);
    if (!certPem && !keyPem) {
      this.logger.warn('QZ_SIGNING_KEY/QZ_SIGNING_CERT unset: stations will see the QZ Tray prompt');
      return;
    }
    if (!certPem || !keyPem) {
      this.logger.error('QZ_SIGNING_KEY and QZ_SIGNING_CERT must be set together; signing disabled');
      return;
    }
    if (!certPem.includes('-----BEGIN CERTIFICATE-----')) {
      this.logger.error('QZ_SIGNING_CERT is not a PEM certificate; signing disabled');
      return;
    }
    try {
      this.key = createPrivateKey(keyPem);
    } catch (error) {
      this.logger.error(`QZ_SIGNING_KEY is not a readable private key: ${(error as Error).message}`);
      return;
    }
    this.cert = certPem;
    this.logger.log('QZ Tray request signing enabled');
  }
}

/**
 * Accepts the PEM either verbatim (with real or literal "\n" line breaks) or
 * base64-encoded as one line, which is the form that survives .env files and
 * deploy dashboards without mangling.
 */
export function decodePem(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('-----BEGIN')) {
    return raw.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded.startsWith('-----BEGIN') ? decoded : null;
  } catch {
    return null;
  }
}
