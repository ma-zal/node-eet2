import { X509Certificate } from 'node:crypto';
import type { Element } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { subjectAttribute, verifyCertificateChain } from '../certificate/chain.js';
import { derToCertificatePem } from '../certificate/pem.js';
import { getResponseSignerTrustStore } from '../certificate/trust.js';
import { DS_NS, SOAP_ENV_NS, WSSE_NS, WSU_NS } from './namespaces.js';
import { InvalidResponseError, parseXmlDocument } from './response.js';

/** IČO Generálního finančního ředitelství, kterému je vydán podpisový certifikát potvrzovacích zpráv. */
const FS_ORGANIZATION_IDENTIFIER = 'NTRCZ-72080043';

export type SignatureVerification = { valid: true } | { valid: false; reason: string };

/**
 * Ověří elektronický podpis potvrzovací datové zprávy (technická specifikace, kap. 5.3):
 * - certifikát v `wsse:BinarySecurityToken` je platný, vydaný přes I.CA a patří GFŘ,
 * - XML podpis sedí,
 * - podepsaný je právě `soapenv:Body` zprávy, ze kterého se čtou data (ochrana proti signature wrapping).
 *
 * Chybové odpovědi podepsané nejsou, ověřuje se jen potvrzení.
 */
export function verifyResponseSignature(xml: string, now: Date = new Date()): SignatureVerification {
  let document;
  try {
    document = parseXmlDocument(xml);
  } catch (error) {
    return invalid(error instanceof InvalidResponseError ? error.message : String(error));
  }

  const tokens = document.getElementsByTagNameNS(WSSE_NS, 'BinarySecurityToken');
  if (tokens.length !== 1) {
    return invalid('odpověď neobsahuje právě jeden BinarySecurityToken');
  }
  const der = Buffer.from((tokens[0].textContent ?? '').replace(/\s+/g, ''), 'base64');
  let signer: X509Certificate;
  try {
    signer = new X509Certificate(der);
  } catch {
    return invalid('certifikát v BinarySecurityToken nelze načíst');
  }

  const trust = getResponseSignerTrustStore();
  const chainError = verifyCertificateChain(signer, trust.intermediates, trust.roots, now);
  if (chainError) {
    return invalid(chainError);
  }
  if (subjectAttribute(signer, 'organizationIdentifier') !== FS_ORGANIZATION_IDENTIFIER) {
    return invalid('podpisový certifikát nepatří Generálnímu finančnímu ředitelství');
  }

  const signatures = document.getElementsByTagNameNS(DS_NS, 'Signature');
  if (signatures.length !== 1) {
    return invalid('odpověď neobsahuje právě jeden XML podpis');
  }
  const signedXml = new SignedXml({ idMode: 'wssecurity', publicCert: derToCertificatePem(der) });
  try {
    signedXml.loadSignature(signatures[0] as unknown as Parameters<SignedXml['loadSignature']>[0]);
    if (!signedXml.checkSignature(xml)) {
      return invalid('XML podpis nesouhlasí');
    }
  } catch (error) {
    return invalid(`XML podpis nelze ověřit: ${error instanceof Error ? error.message : String(error)}`);
  }

  const bodies = document.getElementsByTagNameNS(SOAP_ENV_NS, 'Body');
  const references = signedXml.getReferences();
  const bodyId = bodies.length === 1 ? (bodies[0] as Element).getAttributeNS(WSU_NS, 'Id') : null;
  if (!bodyId || references.length !== 1 || references[0].uri !== `#${bodyId}`) {
    return invalid('podpis se nevztahuje právě na tělo zprávy');
  }
  return { valid: true };
}

function invalid(reason: string): SignatureVerification {
  return { valid: false, reason };
}
