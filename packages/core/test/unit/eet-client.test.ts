import { describe, expect, it } from 'vitest';
import { EetClient, type SendSaleInput } from '../../src/client/eet-client.js';
import { createTestIdentity, readFixture } from './helpers.js';

const { credentials } = createTestIdentity();
const capturedAt = new Date('2026-10-29T18:25:32Z');

const input: SendSaleInput = {
  prvni_zaslani: true,
  data: {
    id_jednotky: 21,
    id_pokl: 'POKLADNA1',
    porad_cis: '162600123',
    dat_trzby: '2026-10-29T18:20:00Z',
    celk_trzba: '123.45',
  },
};

interface Captured {
  url?: string;
  init?: RequestInit;
}

function clientReturning(body: string, status = 200, headers: Record<string, string> = {}) {
  const captured: Captured = {};
  const fetch: typeof globalThis.fetch = async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(body, { status, headers });
  };
  return { client: new EetClient({ environment: 'playground', fetch, now: () => capturedAt }), captured };
}

function clientThrowing(error: Error) {
  const fetch: typeof globalThis.fetch = async () => {
    throw error;
  };
  return new EetClient({ environment: 'playground', fetch, now: () => capturedAt });
}

function chybaResponse(kod: number, text = 'Chyba'): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eet="http://fs.gov.cz/eet/schema/v4">' +
    `<soapenv:Body><eet:Odpoved><eet:Hlavicka dat_odmit="2026-10-29T19:25:33+01:00"/><eet:Chyba kod="${kod}" test="true">${text}</eet:Chyba>` +
    '</eet:Odpoved></soapenv:Body></soapenv:Envelope>'
  );
}

describe('EetClient.sendSale', () => {
  it('odešle podepsanou zprávu s povinnými HTTP hlavičkami na endpoint prostředí', async () => {
    const { client, captured } = clientReturning(readFixture('responses/accepted.xml'));
    await client.sendSale(input, credentials);

    expect(captured.url).toBe('https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4');
    expect(captured.init?.method).toBe('POST');
    expect(captured.init?.headers).toMatchObject({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://fs.gov.cz/eet/OdeslaniTrzby"',
    });
    const body = String(captured.init?.body);
    expect(body).toContain('prvni_zaslani="true"');
    expect(body).toContain('eic_popl="CZ00000019"');
    expect(body).toContain('dat_trzby="2026-10-29T19:20:00+01:00"');
    expect(body).toContain('dat_odesl="2026-10-29T19:25:32+01:00"');
    expect(body).toContain('<ds:Signature');
  });

  it('potvrzení → accepted s POK, ověřeným podpisem a transakčním ID', async () => {
    const { client } = clientReturning(readFixture('responses/accepted.xml'), 200, { 'X-Global-Transaction-Id': 'abc123' });
    const result = await client.sendSale(input, credentials);
    expect(result).toMatchObject({
      result: 'accepted',
      prvni_zaslani: true,
      dat_prij: '2026-10-29T19:25:32+01:00',
      pok: 'f527b0bb-6534-474e-ab3f-986a62bc3e1a-ff',
      test: true,
      signature_valid: true,
      warnings: [],
      global_transaction_id: 'abc123',
    });
    expect(result.uuid_zpravy).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).not.toHaveProperty('signature_error');
  });

  it('potvrzení s varováními → accepted, varování ve warnings', async () => {
    const { client } = clientReturning(readFixture('responses/warning.xml'));
    const result = await client.sendSale(input, credentials);
    expect(result.result).toBe('accepted');
    expect(result.result === 'accepted' && result.warnings.map((warning) => warning.kod_varov)).toEqual([5, 6]);
  });

  it('kód 0 v ověřovacím módu → verified', async () => {
    const { client, captured } = clientReturning(readFixture('responses/verified.xml'));
    const result = await client.sendSale({ ...input, overeni: true }, credentials);
    expect(String(captured.init?.body)).toContain('overeni="true"');
    expect(result).toMatchObject({ result: 'verified', test: true, warnings: [] });
  });

  it.each([2, 3, 4, 6, 7, 1, 5, 9])('kód %i → rejected', async (kod) => {
    const { client } = clientReturning(chybaResponse(kod));
    expect(await client.sendSale(input, credentials)).toMatchObject({
      result: 'rejected',
      dat_odmit: '2026-10-29T19:25:33+01:00',
      error: { type: 'eet', kod },
    });
  });

  it.each([-1, -2, 8])('kód %i → retry', async (kod) => {
    const { client } = clientReturning(chybaResponse(kod));
    expect(await client.sendSale(input, credentials)).toMatchObject({ result: 'retry', error: { type: 'eet', kod } });
  });

  it('timeout → retry', async () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const result = await clientThrowing(error).sendSale(input, credentials);
    expect(result).toMatchObject({ result: 'retry', prvni_zaslani: true, error: { type: 'timeout' } });
    expect(result.uuid_zpravy).toBeDefined();
  });

  it('síťová chyba → retry', async () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    expect(await clientThrowing(error).sendSale(input, credentials)).toMatchObject({
      result: 'retry',
      error: { type: 'network', message: 'Síťová chyba: ENOTFOUND (getaddrinfo ENOTFOUND)' },
    });
  });

  it('HTTP 502 bez odpovědi EET → retry http', async () => {
    const { client } = clientReturning('<html>Bad gateway</html>', 502);
    expect(await client.sendSale(input, credentials)).toMatchObject({ result: 'retry', error: { type: 'http' } });
  });

  it('nečitelná odpověď s HTTP 200 → retry invalid_response', async () => {
    const { client } = clientReturning('nesmysl');
    expect(await client.sendSale(input, credentials)).toMatchObject({ result: 'retry', error: { type: 'invalid_response' } });
  });

  it('SOAP Fault → retry soap_fault', async () => {
    const fault =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
      '<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Internal Error</faultstring></soapenv:Fault>' +
      '</soapenv:Body></soapenv:Envelope>';
    const { client } = clientReturning(fault, 500);
    expect(await client.sendSale(input, credentials)).toMatchObject({
      result: 'retry',
      error: { type: 'soap_fault', message: 'Internal Error' },
    });
  });

  it('neplatná data → rejected validation, nic se neodešle', async () => {
    const { client, captured } = clientReturning(readFixture('responses/accepted.xml'));
    const result = await client.sendSale({ ...input, data: { ...input.data, celk_trzba: '1.0' } }, credentials);
    expect(result).toMatchObject({ result: 'rejected', error: { type: 'validation' } });
    expect(result).not.toHaveProperty('uuid_zpravy');
    expect(captured.url).toBeUndefined();
  });

  it('podvržené potvrzení → accepted, ale signature_valid=false s důvodem', async () => {
    const tampered = readFixture('responses/accepted.xml').replace('pok="f527b0bb', 'pok="00000000');
    const { client } = clientReturning(tampered);
    expect(await client.sendSale(input, credentials)).toMatchObject({
      result: 'accepted',
      signature_valid: false,
      signature_error: 'XML podpis nesouhlasí',
    });
  });

  it('mezní doba odezvy pod 2 s je chyba konfigurace', () => {
    expect(() => new EetClient({ environment: 'production', timeoutMs: 1000 })).toThrow(RangeError);
  });
});
