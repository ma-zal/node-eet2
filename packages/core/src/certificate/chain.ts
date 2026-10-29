import type { X509Certificate } from 'node:crypto';

const MAX_CHAIN_DEPTH = 5;

/**
 * Ověří, že certifikát vede přes zadané mezilehlé certifikáty ke kořenové CA.
 * Kontroluje vazbu vydavatel–subjekt i kryptografický podpis každého článku.
 *
 * @param now Pokud je zadán, kontroluje se i doba platnosti všech certifikátů v řetězci.
 * @returns `undefined` při úspěchu, jinak popis problému (česky).
 */
export function verifyCertificateChain(
  leaf: X509Certificate,
  intermediates: readonly X509Certificate[],
  roots: readonly X509Certificate[],
  now?: Date,
): string | undefined {
  let current = leaf;
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    if (now && !isValidAt(current, now)) {
      return `certifikát "${commonName(current)}" není v daném okamžiku platný (${current.validFrom} – ${current.validTo})`;
    }
    const root = roots.find((candidate) => isIssuedBy(current, candidate));
    if (root) {
      if (now && !isValidAt(root, now)) {
        return `kořenový certifikát "${commonName(root)}" není v daném okamžiku platný`;
      }
      return undefined;
    }
    const intermediate = intermediates.find((candidate) => isIssuedBy(current, candidate));
    if (!intermediate) {
      return `certifikát "${commonName(current)}" nevydala žádná důvěryhodná certifikační autorita`;
    }
    current = intermediate;
  }
  return 'řetězec certifikátů je příliš dlouhý';
}

function isIssuedBy(cert: X509Certificate, issuer: X509Certificate): boolean {
  return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
}

function isValidAt(cert: X509Certificate, now: Date): boolean {
  return new Date(cert.validFrom) <= now && now <= new Date(cert.validTo);
}

/** Vrátí hodnotu CN ze subjectu certifikátu. */
export function commonName(cert: X509Certificate): string | undefined {
  return subjectAttribute(cert, 'CN');
}

/** Vrátí hodnotu atributu ze subjectu certifikátu (formát `X509Certificate.subject` je `KEY=value` po řádcích). */
export function subjectAttribute(cert: X509Certificate, key: string): string | undefined {
  const prefix = `${key}=`;
  return cert.subject
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}
