import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import type { EetEnvironment } from '../environment.js';
import { verifyCertificateChain } from './chain.js';
import type { EetCredentials } from './credentials.js';

// Adresář certs/ leží v kořeni balíčku; ze src/certificate/ i dist/certificate/ je to stejná relativní cesta.
const CERTS_DIR = new URL('../../certs/', import.meta.url);

function loadCertificate(relativePath: string): X509Certificate {
  return new X509Certificate(readFileSync(new URL(relativePath, CERTS_DIR)));
}

interface TrustStore {
  intermediates: X509Certificate[];
  roots: X509Certificate[];
}

let caEetStores: Record<EetEnvironment, TrustStore> | undefined;
let responseSignerStore: TrustStore | undefined;

/** Kořenové a vydávající certifikáty CA EET pro jednotlivá prostředí. */
function getCaEetStores(): Record<EetEnvironment, TrustStore> {
  caEetStores ??= {
    playground: {
      intermediates: [loadCertificate('ca-eet/playground-sub.pem')],
      roots: [loadCertificate('ca-eet/playground-root.pem')],
    },
    production: {
      intermediates: [loadCertificate('ca-eet/production-sub.pem')],
      roots: [loadCertificate('ca-eet/production-root.pem')],
    },
  };
  return caEetStores;
}

/**
 * Certifikáty I.CA, kterými je vydán podpisový certifikát potvrzovacích zpráv
 * (Přístupové a provozní informace, kap. 3.3; otisky ověřeny proti https://www.ica.cz/korenove-certifikaty).
 */
export function getResponseSignerTrustStore(): TrustStore {
  responseSignerStore ??= {
    intermediates: [loadCertificate('ica/pca22_rsa.pem')],
    roots: [loadCertificate('ica/rca22_rsa.pem')],
  };
  return responseSignerStore;
}

/**
 * Zjistí, kterou CA EET (playground / produkce) byl pokladní certifikát vydán.
 * Dobu platnosti nekontroluje – i prošlý certifikát patří do svého prostředí.
 *
 * @returns prostředí, nebo `undefined`, pokud certifikát nevydala žádná známá CA EET.
 */
export function detectCertificateEnvironment(credentials: Pick<EetCredentials, 'cert_pem'>): EetEnvironment | undefined {
  const cert = new X509Certificate(credentials.cert_pem);
  const stores = getCaEetStores();
  return (Object.keys(stores) as EetEnvironment[]).find(
    (environment) => verifyCertificateChain(cert, stores[environment].intermediates, stores[environment].roots) === undefined,
  );
}
