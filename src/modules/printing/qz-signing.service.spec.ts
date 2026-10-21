import { createVerify, generateKeyPairSync } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { QzSigningService, decodePem } from './qz-signing.service';

// A throwaway RSA pair; the certificate text only has to look like one, since
// the service hands it to the browser verbatim and never parses it.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

const ENV_KEYS = ['QZ_SIGNING_KEY', 'QZ_SIGNING_CERT'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('decodePem', () => {
  it('passes a verbatim PEM through, restoring literal \\n line breaks', () => {
    expect(decodePem('-----BEGIN X-----\\nabc\\n-----END X-----')).toBe(
      '-----BEGIN X-----\nabc\n-----END X-----',
    );
  });

  it('decodes a one-line base64 PEM', () => {
    const b64 = Buffer.from(CERT_PEM).toString('base64');
    expect(decodePem(b64)).toBe(CERT_PEM);
  });

  it('is null for blank or non-PEM input', () => {
    expect(decodePem(undefined)).toBeNull();
    expect(decodePem('   ')).toBeNull();
    expect(decodePem('not a certificate')).toBeNull();
  });
});

describe('QzSigningService', () => {
  it('reports unconfigured and answers 503 when the pair is unset', () => {
    const service = new QzSigningService();
    expect(service.configured).toBe(false);
    expect(() => service.certificate()).toThrow(ServiceUnavailableException);
    expect(() => service.sign('abc')).toThrow(ServiceUnavailableException);
  });

  it('refuses a key without its certificate', () => {
    process.env.QZ_SIGNING_KEY = KEY_PEM;
    const service = new QzSigningService();
    expect(service.configured).toBe(false);
  });

  it('refuses an unreadable key', () => {
    process.env.QZ_SIGNING_KEY = '-----BEGIN PRIVATE KEY-----\ngarbage\n-----END PRIVATE KEY-----';
    process.env.QZ_SIGNING_CERT = CERT_PEM;
    const service = new QzSigningService();
    expect(service.configured).toBe(false);
  });

  it('signs the way QZ Tray verifies: RSA-SHA512 over the string, base64 out', () => {
    process.env.QZ_SIGNING_KEY = Buffer.from(KEY_PEM).toString('base64');
    process.env.QZ_SIGNING_CERT = Buffer.from(CERT_PEM).toString('base64');
    const service = new QzSigningService();

    expect(service.configured).toBe(true);
    expect(service.certificate()).toBe(CERT_PEM);

    // What qz-tray.js sends: the SHA-256 hex digest of the call.
    const toSign = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const signature = service.sign(toSign);

    const verifier = createVerify('SHA512');
    verifier.update(toSign, 'utf8');
    expect(verifier.verify(publicKey, signature, 'base64')).toBe(true);

    const tampered = createVerify('SHA512');
    tampered.update(toSign + 'x', 'utf8');
    expect(tampered.verify(publicKey, signature, 'base64')).toBe(false);
  });
});
