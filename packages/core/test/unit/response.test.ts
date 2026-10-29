import { describe, expect, it } from 'vitest';
import { InvalidResponseError, parseResponse } from '../../src/soap/response.js';
import { readFixture } from './helpers.js';

// Fixtures jsou skutečné odpovědi playground EET z 29. 10. 2026.
describe('parseResponse', () => {
  it('potvrzení s POK', () => {
    expect(parseResponse(readFixture('responses/accepted.xml'))).toEqual({
      kind: 'potvrzeni',
      uuid_zpravy: '935632d8-5749-4f9d-9935-7c5cc2750f86',
      dat_prij: '2026-10-29T19:25:32+01:00',
      pok: 'f527b0bb-6534-474e-ab3f-986a62bc3e1a-ff',
      test: true,
      warnings: [],
    });
  });

  it('potvrzení s varováními', () => {
    const parsed = parseResponse(readFixture('responses/warning.xml'));
    expect(parsed.kind).toBe('potvrzeni');
    expect(parsed.kind === 'potvrzeni' && parsed.warnings).toEqual([
      { kod_varov: 5, message: 'Datum a cas prijeti trzby je vyrazne v minulosti' },
      { kod_varov: 6, message: 'id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky' },
    ]);
  });

  it('ověřovací mód – chyba s kódem 0', () => {
    expect(parseResponse(readFixture('responses/verified.xml'))).toEqual({
      kind: 'chyba',
      uuid_zpravy: '881b0745-cd49-4609-990c-961a5cb869ca',
      dat_odmit: '2026-10-29T19:25:33+01:00',
      kod: 0,
      message: 'Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat',
      test: true,
      warnings: [],
    });
  });

  it('chyba s kódem 3', () => {
    expect(parseResponse(readFixture('responses/rejected.xml'))).toMatchObject({
      kind: 'chyba',
      kod: 3,
      message: 'XML zprava nevyhovela kontrole XML schematu',
      test: true,
    });
  });

  it('chyba bez UUID, s víceřádkovým textem', () => {
    const xml =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eet="http://fs.gov.cz/eet/schema/v4">' +
      '<soapenv:Body><eet:Odpoved><eet:Hlavicka dat_odmit="2027-03-04T18:25:21+01:00"/>' +
      '<eet:Chyba kod="-1">\n  Docasna technicka chyba zpracovani –\n  odeslete prosim datovou zpravu pozdeji\n</eet:Chyba>' +
      '</eet:Odpoved></soapenv:Body></soapenv:Envelope>';
    expect(parseResponse(xml)).toEqual({
      kind: 'chyba',
      dat_odmit: '2027-03-04T18:25:21+01:00',
      kod: -1,
      message: 'Docasna technicka chyba zpracovani – odeslete prosim datovou zpravu pozdeji',
      test: false,
      warnings: [],
    });
  });

  it('SOAP Fault', () => {
    const xml =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
      '<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Internal Error</faultstring></soapenv:Fault>' +
      '</soapenv:Body></soapenv:Envelope>';
    expect(parseResponse(xml)).toEqual({ kind: 'fault', message: 'Internal Error' });
  });

  it.each([
    ['ne-XML', '<html><body>Bad gateway'],
    ['prázdné tělo', ''],
    ['XML bez odpovědi', '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body/></soapenv:Envelope>'],
  ])('odmítne %s', (_label, xml) => {
    expect(() => parseResponse(xml)).toThrow(InvalidResponseError);
  });
});
