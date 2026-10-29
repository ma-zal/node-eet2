import { createHash, createSign, X509Certificate } from 'node:crypto';
import type { EetCredentials } from '../certificate/credentials.js';

/**
 * Platnost JWT. CA EET odmítá tokeny, kde je `exp` více než 5 minut po `iat`; bereme 4 minuty jako rezervu.
 */
const JWT_LIFETIME_SECONDS = 240;

/** O kolik se `iat` posune do minulosti, aby token prošel i při mírně předbíhajících hodinách pokladny. */
const CLOCK_SKEW_SECONDS = 30;

/**
 * Vytvoří JWT pro autentizaci k CA EET API (postupy CA EET v2, kap. Autentizace k rozhraní):
 * - header `alg: RS256`, `typ: JWT`, `x5t#S256` = base64url(SHA-256(DER certifikátu)),
 * - payload `iat` a `exp`,
 * - podpis privátním klíčem certifikátu, kterým se volající autentizuje (obnovovaný certifikát).
 *
 * Certifikát se do tokenu neposílá (`x5c` se nepoužívá), CA ho dohledá podle `x5t#S256`.
 */
export function createCaJwt(credentials: Pick<EetCredentials, 'cert_pem' | 'key_pem'>, now: Date): string {
  const der = new X509Certificate(credentials.cert_pem).raw;
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    'x5t#S256': createHash('sha256').update(der).digest('base64url'),
  };
  const iat = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_SECONDS;
  const payload = { iat, exp: iat + JWT_LIFETIME_SECONDS };

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(credentials.key_pem);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
