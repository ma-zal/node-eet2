import { randomUUID } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import type { EetCredentials } from '../certificate/credentials.js';
import { pemToBase64 } from '../certificate/pem.js';
import type { NormalizedSaleData } from '../sale/sale-data.js';
import {
  BASE64_BINARY,
  EET_NS,
  EXC_C14N,
  RSA_SHA256,
  SHA256,
  SOAP_ENV_NS,
  WSSE_NS,
  WSU_NS,
  X509V3_TOKEN,
} from './namespaces.js';

/** Hlavička datové zprávy (element `<Hlavicka>`). */
export interface MessageHeader {
  uuid_zpravy: string;
  dat_odesl: string;
  prvni_zaslani: boolean;
  /** Ověřovací mód. Uvádí se jen hodnota `true`. */
  overeni?: boolean;
}

/**
 * Maximální velikost datové zprávy včetně SOAP obálky (kritická kontrola č. 5: 12 kB).
 * Počítáno konzervativně v bajtech po tisících.
 */
export const MAX_MESSAGE_BYTES = 12_000;

/**
 * Sestaví datovou zprávu evidované tržby a podepíše ji dle WS-Security (technická specifikace, kap. 5.2):
 * podepisuje se právě element `soapenv:Body`, Exclusive C14N, SHA-256, RSA-SHA256,
 * certifikát poplatníka je v `wsse:BinarySecurityToken`.
 *
 * Postup podpisu je převzatý z ověřeného PoC. Seznamy inclusive prefixů zrcadlí vzorové zprávy Finanční správy.
 */
export function buildSignedMessage(header: MessageHeader, data: NormalizedSaleData, credentials: EetCredentials): string {
  const tokenId = `SecurityToken-${randomUUID()}`;
  const bodyId = `Body-${randomUUID()}`;

  const hlavicka = attributes([
    ['uuid_zpravy', header.uuid_zpravy],
    ['dat_odesl', header.dat_odesl],
    ['prvni_zaslani', String(header.prvni_zaslani)],
    ['overeni', header.overeni ? 'true' : undefined],
  ]);
  // Pořadí atributů odpovídá XSD.
  const dataAttributes = attributes([
    ['eic_popl', data.eic_popl],
    ['eic_poverujiciho', data.eic_poverujiciho],
    ['povereni_vice_popl', data.povereni_vice_popl === undefined ? undefined : String(data.povereni_vice_popl)],
    ['id_jednotky', String(data.id_jednotky)],
    ['id_pokl', data.id_pokl],
    ['porad_cis', data.porad_cis],
    ['dat_trzby', data.dat_trzby],
    ['celk_trzba', data.celk_trzba],
    ['urceno_cerp_zuct', data.urceno_cerp_zuct],
    ['cerp_zuct', data.cerp_zuct],
  ]);

  const unsigned =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:v4="${EET_NS}">` +
    '<soapenv:Header>' +
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" soapenv:mustUnderstand="1">` +
    `<wsse:BinarySecurityToken wsu:Id="${tokenId}" EncodingType="${BASE64_BINARY}" ValueType="${X509V3_TOKEN}">` +
    pemToBase64(credentials.cert_pem) +
    '</wsse:BinarySecurityToken>' +
    '</wsse:Security>' +
    '</soapenv:Header>' +
    `<soapenv:Body xmlns:wsu="${WSU_NS}" wsu:Id="${bodyId}">` +
    `<v4:Trzba><v4:Hlavicka${hlavicka}/><v4:Data${dataAttributes}/></v4:Trzba>` +
    '</soapenv:Body>' +
    '</soapenv:Envelope>';

  // Prefix listy musí být pole – jako string je xml-crypto zahodí.
  const signature = new SignedXml({
    idMode: 'wssecurity',
    privateKey: credentials.key_pem,
    publicCert: credentials.cert_pem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
    inclusiveNamespacesPrefixList: ['soapenv', 'v4'],
    getKeyInfoContent: () =>
      `<wsse:SecurityTokenReference xmlns:wsse="${WSSE_NS}">` +
      `<wsse:Reference URI="#${tokenId}" ValueType="${X509V3_TOKEN}"/>` +
      '</wsse:SecurityTokenReference>',
  });
  signature.addReference({
    xpath: "//*[local-name(.)='Body']",
    transforms: [EXC_C14N],
    digestAlgorithm: SHA256,
    inclusiveNamespacesPrefixList: ['v4'],
  });
  signature.computeSignature(unsigned, {
    prefix: 'ds',
    location: { reference: "//*[local-name(.)='Security']", action: 'append' },
  });
  return signature.getSignedXml();
}

function attributes(entries: Array<[string, string | undefined]>): string {
  return entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
