import forge from 'node-forge';
import { EetCertificateError } from '../errors.js';
import { credentialsFromPem, type EetCredentials } from './credentials.js';

/**
 * Načte pokladní certifikát z `.p12` souboru vydaného CA EET.
 *
 * CA EET vydává `.p12` v legacy formátu se šifrováním 3DES, který OpenSSL 3 (a tedy `node:crypto`)
 * bez legacy provideru nenačte. Proto se soubor zpracuje pure-JS knihovnou node-forge
 * a klíč s certifikáty se převedou do PEM.
 *
 * @throws {EetCertificateError} při chybném hesle, poškozeném souboru nebo nečekaném obsahu.
 */
export function loadPkcs12(pkcs12: Uint8Array, password: string): EetCredentials {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pkcs12).toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new EetCertificateError('Soubor .p12 se nepodařilo otevřít. Zkontrolujte heslo a zda jde o pokladní certifikát z CA EET.');
  }

  const keys = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
    .map((bag) => bag.key)
    .filter((key): key is forge.pki.rsa.PrivateKey => key !== undefined);
  if (keys.length !== 1) {
    throw new EetCertificateError(`Soubor .p12 musí obsahovat právě jeden privátní klíč (obsahuje ${keys.length}).`);
  }
  const key = keys[0];

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => cert !== undefined);

  // Koncový certifikát je ten, jehož veřejný klíč odpovídá privátnímu klíči. Ostatní tvoří certifikační cestu.
  const leaf = certs.find((cert) => {
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    return publicKey.n?.equals(key.n) && publicKey.e?.equals(key.e);
  });
  if (!leaf) {
    throw new EetCertificateError('Soubor .p12 neobsahuje certifikát k privátnímu klíči.');
  }

  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  const chainPem = certs.filter((cert) => cert !== leaf).map((cert) => forge.pki.certificateToPem(cert));
  return credentialsFromPem(forge.pki.certificateToPem(leaf), keyPem, chainPem);
}
