import { describe, expect, it } from 'vitest';
import { credentialsFromPem } from '../../src/certificate/credentials.js';
import { loadPkcs12 } from '../../src/certificate/pkcs12.js';
import { detectCertificateEnvironment } from '../../src/certificate/trust.js';
import { EetCertificateError } from '../../src/errors.js';
import { createTestIdentity, readFixture, toLegacyPkcs12 } from './helpers.js';

describe('loadPkcs12', () => {
  const identity = createTestIdentity({ commonName: 'CZ683555118' });

  it('načte legacy .p12 (3DES) a vrátí metadata', () => {
    const credentials = loadPkcs12(toLegacyPkcs12(identity, 'ABcd1234'), 'ABcd1234');
    expect(credentials).toMatchObject({
      eic: 'CZ683555118',
      serial_number: String(0x0a1b2c3d),
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_to: '2027-01-02T00:00:00.000Z',
      chain_pem: [],
    });
    expect(credentials.key_pem).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('chybné heslo vyhodí srozumitelnou chybu', () => {
    expect(() => loadPkcs12(toLegacyPkcs12(identity, 'ABcd1234'), 'spatne11')).toThrow(EetCertificateError);
  });

  it('poškozený soubor vyhodí srozumitelnou chybu', () => {
    expect(() => loadPkcs12(Buffer.from('nesmysl'), 'ABcd1234')).toThrow(EetCertificateError);
  });

  it('odmítne certifikát, jehož CN není EIČ', () => {
    const other = createTestIdentity({ commonName: 'Jan Novak' });
    expect(() => loadPkcs12(toLegacyPkcs12(other, 'ABcd1234'), 'ABcd1234')).toThrow(/není EIČ/);
  });
});

describe('credentialsFromPem', () => {
  it('odmítne klíč, který nepatří k certifikátu', () => {
    const a = createTestIdentity();
    const b = createTestIdentity();
    expect(() => credentialsFromPem(a.credentials.cert_pem, b.credentials.key_pem)).toThrow(/nepatří/);
  });
});

describe('detectCertificateEnvironment', () => {
  it('pozná certifikát vydaný CA EET pro playground', () => {
    expect(detectCertificateEnvironment({ cert_pem: readFixture('playground-CZ00000019.cert.pem') })).toBe('playground');
  });

  it('cizí certifikát nepatří do žádného prostředí', () => {
    expect(detectCertificateEnvironment(createTestIdentity().credentials)).toBeUndefined();
  });
});
