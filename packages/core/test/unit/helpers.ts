import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { credentialsFromPem, type EetCredentials } from '../../src/certificate/credentials.js';

/** Testovací klíč a self-signed certifikát (nejde o certifikát Finanční správy). */
export interface TestIdentity {
  /** Počítá se až při přístupu, aby šlo vytvořit i identitu s neplatným CN. */
  readonly credentials: EetCredentials;
  forgeKey: forge.pki.rsa.PrivateKey;
  forgeCert: forge.pki.Certificate;
}

/** Vygeneruje RSA klíč (přes node:crypto kvůli rychlosti) a self-signed certifikát s CN = EIČ. */
export function createTestIdentity(options: { commonName?: string; validFrom?: Date; validTo?: Date } = {}): TestIdentity {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = '0a1b2c3d';
  cert.validity.notBefore = options.validFrom ?? new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = options.validTo ?? new Date('2027-01-02T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: options.commonName ?? 'CZ00000019' },
    { name: 'countryName', value: 'CZ' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgeKey, forge.md.sha256.create());

  return {
    get credentials() {
      return credentialsFromPem(forge.pki.certificateToPem(cert), keyPem);
    },
    forgeKey,
    forgeCert: cert,
  };
}

/** Zabalí identitu do `.p12` v legacy formátu 3DES, jako ho vydává CA EET. */
export function toLegacyPkcs12(identity: TestIdentity, password: string): Buffer {
  const asn1 = forge.pkcs12.toPkcs12Asn1(identity.forgeKey, [identity.forgeCert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

/** Načte testovací fixture z `test/fixtures/`. */
export function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../fixtures/${relativePath}`, import.meta.url), 'utf8');
}
