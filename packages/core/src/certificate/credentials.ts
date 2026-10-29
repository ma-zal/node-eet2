import { createPrivateKey, X509Certificate } from 'node:crypto';
import { EetCertificateError } from '../errors.js';
import { commonName } from './chain.js';

/**
 * Pokladní certifikát s privátním klíčem připravený k podpisu datových zpráv.
 * Metadata jsou předpočítaná, aby je šlo bez dalšího zpracování uložit nebo zobrazit.
 */
export interface EetCredentials {
  /** Certifikát poplatníka v PEM. */
  cert_pem: string;
  /** Privátní klíč v PEM (PKCS#8, nešifrovaný). Nikdy ho nelogovat ani nevracet přes API. */
  key_pem: string;
  /** Certifikáty certifikační cesty (mezilehlý a kořenový) v PEM, pokud byly k dispozici. */
  chain_pem: string[];
  /** EIČ poplatníka z CN certifikátu. */
  eic: string;
  /** Sériové číslo certifikátu v desítkové soustavě (stejně jako v CA EET API). */
  serial_number: string;
  /** Začátek platnosti (ISO 8601). */
  valid_from: string;
  /** Konec platnosti (ISO 8601). */
  valid_to: string;
}

const EIC_PATTERN = /^CZ[0-9]{8,10}$/;

/**
 * Sestaví {@link EetCredentials} z certifikátu a privátního klíče v PEM.
 * Ověří, že klíč k certifikátu patří a že CN certifikátu je EIČ.
 *
 * @throws {EetCertificateError} pokud certifikát nebo klíč nelze načíst nebo k sobě nepatří.
 */
export function credentialsFromPem(certPem: string, keyPem: string, chainPem: string[] = []): EetCredentials {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    throw new EetCertificateError('Certifikát se nepodařilo načíst.');
  }

  let keyMatches: boolean;
  try {
    keyMatches = cert.checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    throw new EetCertificateError('Privátní klíč se nepodařilo načíst.');
  }
  if (!keyMatches) {
    throw new EetCertificateError('Privátní klíč nepatří k certifikátu.');
  }

  const eic = commonName(cert);
  if (eic === undefined || !EIC_PATTERN.test(eic)) {
    throw new EetCertificateError(`Certifikát není pokladní certifikát EET: CN "${eic ?? ''}" není EIČ.`);
  }

  return {
    cert_pem: cert.toString(),
    key_pem: keyPem,
    chain_pem: chainPem,
    eic,
    serial_number: BigInt(`0x${cert.serialNumber}`).toString(10),
    valid_from: new Date(cert.validFrom).toISOString(),
    valid_to: new Date(cert.validTo).toISOString(),
  };
}
