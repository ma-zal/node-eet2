import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { describe, expect, it } from 'vitest';
import { buildSignedMessage } from '../../src/soap/message.js';
import { DS_NS, EET_NS } from '../../src/soap/namespaces.js';
import type { NormalizedSaleData } from '../../src/sale/sale-data.js';
import { createTestIdentity } from './helpers.js';

const identity = createTestIdentity();
const data: NormalizedSaleData = {
  eic_popl: 'CZ00000019',
  id_jednotky: 181,
  id_pokl: 'POKLADNA1',
  porad_cis: '162600123',
  dat_trzby: '2027-01-07T22:01:00+01:00',
  celk_trzba: '350.00',
};
const header = {
  uuid_zpravy: 'e23e5a5a-08d7-4a08-844d-2b6c6b60621d',
  dat_odesl: '2027-01-07T22:01:01+01:00',
  prvni_zaslani: true,
};

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

describe('buildSignedMessage', () => {
  it('obsahuje hlavičku a data tržby', () => {
    const document = parse(buildSignedMessage(header, data, identity.credentials));
    const hlavicka = document.getElementsByTagNameNS(EET_NS, 'Hlavicka')[0];
    expect(hlavicka.getAttribute('uuid_zpravy')).toBe(header.uuid_zpravy);
    expect(hlavicka.getAttribute('dat_odesl')).toBe(header.dat_odesl);
    expect(hlavicka.getAttribute('prvni_zaslani')).toBe('true');
    expect(hlavicka.hasAttribute('overeni')).toBe(false);

    const dataElement = document.getElementsByTagNameNS(EET_NS, 'Data')[0];
    expect(dataElement.getAttribute('eic_popl')).toBe('CZ00000019');
    expect(dataElement.getAttribute('id_jednotky')).toBe('181');
    expect(dataElement.getAttribute('celk_trzba')).toBe('350.00');
    expect(dataElement.hasAttribute('cerp_zuct')).toBe(false);
  });

  it('v ověřovacím módu uvede overeni="true"', () => {
    const document = parse(buildSignedMessage({ ...header, prvni_zaslani: false, overeni: true }, data, identity.credentials));
    const hlavicka = document.getElementsByTagNameNS(EET_NS, 'Hlavicka')[0];
    expect(hlavicka.getAttribute('overeni')).toBe('true');
    expect(hlavicka.getAttribute('prvni_zaslani')).toBe('false');
  });

  it('podpis se vztahuje na Body a ověří se certifikátem poplatníka', () => {
    const xml = buildSignedMessage(header, data, identity.credentials);
    const document = parse(xml);
    const signature = new SignedXml({ idMode: 'wssecurity', publicCert: identity.credentials.cert_pem });
    signature.loadSignature(document.getElementsByTagNameNS(DS_NS, 'Signature')[0] as never);
    expect(signature.checkSignature(xml)).toBe(true);

    const references = signature.getReferences();
    expect(references).toHaveLength(1);
    expect(references[0].uri).toMatch(/^#Body-/);
  });

  it('změna dat po podpisu podpis zneplatní', () => {
    const xml = buildSignedMessage(header, data, identity.credentials).replace('celk_trzba="350.00"', 'celk_trzba="1.00"');
    const signature = new SignedXml({ idMode: 'wssecurity', publicCert: identity.credentials.cert_pem });
    signature.loadSignature(parse(xml).getElementsByTagNameNS(DS_NS, 'Signature')[0] as never);
    expect(signature.checkSignature(xml)).toBe(false);
  });
});
