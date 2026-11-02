import { beforeEach, describe, expect, it } from 'vitest';
import { CaEetClient, CertificateManager, EetClient, MemoryCertificateStore, type EetEnvironment } from 'eet2-core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestIdentity, readFixture, toLegacyPkcs12 } from '../../core/test/unit/helpers.js';

const PASSWORD = 'ABcd1234';
// Testovací certifikát platí 1. 1. 2026 – 2. 1. 2027; podpis ve fixture odpovědi platí v tomto okamžiku.
const NOW = new Date('2026-10-29T18:25:32Z');
const identity = createTestIdentity();
const p12Base64 = toLegacyPkcs12(identity, PASSWORD).toString('base64');

const sale = {
  environment: 'playground',
  prvni_zaslani: true,
  data: { id_jednotky: 21, id_pokl: 'POKLADNA1', porad_cis: '162600123', dat_trzby: '2026-10-29T18:20:00Z', celk_trzba: '123.45' },
};

let now: Date;
let eetResponses: Array<() => Response>;
let eetCalls: string[];
/** Prostředí, které testovací certifikát „vydala“ CA EET. */
let certificateEnvironment: EetEnvironment;

function createEetClient(environment: EetEnvironment): EetClient {
  return new EetClient({
    environment,
    now: () => now,
    fetch: async (url) => {
      eetCalls.push(String(url));
      const next = eetResponses.shift();
      if (!next) throw new Error('Test nečekal volání EET.');
      return next();
    },
  });
}

async function createApp(options: { ca?: boolean } = {}): Promise<FastifyInstance> {
  const manager = new CertificateManager({
    store: new MemoryCertificateStore(),
    ca: options.ca
      ? { playground: new CaEetClient({ baseUrl: 'https://ca.invalid/api', fetch: async () => new Response(null, { status: 503 }) }) }
      : undefined,
    now: () => now,
    detectEnvironment: () => certificateEnvironment,
  });
  await manager.load();
  return buildApp({
    manager,
    eetClients: { playground: createEetClient('playground'), production: createEetClient('production') },
    keyEncrypted: false,
    versions: { service_version: '0.1.0', core_version: '0.1.0', git_sha: 'abc123' },
    now: () => now,
  });
}

async function uploadCertificate(app: FastifyInstance, environment: EetEnvironment = 'playground') {
  return app.inject({ method: 'PUT', url: '/api/v1/certificate', payload: { pkcs12: p12Base64, password: PASSWORD, environment } });
}

beforeEach(() => {
  now = NOW;
  eetResponses = [];
  eetCalls = [];
  certificateEnvironment = 'playground';
});

describe('bez certifikátu', () => {
  it('GET /healthy je zdravý', async () => {
    const app = await createApp();
    const response = await app.inject('/healthy');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/status ukazuje verze, prostředí bez certifikátu není', async () => {
    const app = await createApp();
    expect((await app.inject('/api/v1/status')).json()).toEqual({
      environment: null,
      service_version: '0.1.0',
      core_version: '0.1.0',
      git_sha: 'abc123',
      key_encrypted: false,
      renewal: { state: 'idle', automatic: false },
    });
  });

  it('POST /api/v1/sales vrátí 503 no_certificate a nic neodešle', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload: sale });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { type: 'no_certificate' } });
    expect(eetCalls).toEqual([]);
  });
});

describe('PUT /api/v1/certificate', () => {
  it('nahraje certifikát a vrátí jeho stav bez privátního klíče', async () => {
    const app = await createApp();
    const response = await uploadCertificate(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      certificate: { eic: 'CZ00000019', valid_to: '2027-01-02T00:00:00.000Z', source: 'upload' },
      renewal: { state: 'idle', automatic: false },
    });
    expect(response.body).not.toContain('PRIVATE KEY');
    const status = await app.inject('/api/v1/status');
    expect(status.body).not.toContain('PRIVATE KEY');
    expect(status.json()).toMatchObject({ environment: 'playground' });
  });

  it('chybné heslo → 400 invalid_certificate', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/certificate',
      payload: { pkcs12: p12Base64, password: 'spatne11', environment: 'playground' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { type: 'invalid_certificate' } });
  });

  it.each([
    ['heslo', { pkcs12: p12Base64, environment: 'playground' }],
    ['prostředí', { pkcs12: p12Base64, password: PASSWORD }],
  ])('chybějící %s → 400 validation', async (_label, payload) => {
    const app = await createApp();
    const response = await app.inject({ method: 'PUT', url: '/api/v1/certificate', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { type: 'validation' } });
  });

  it('zvolené prostředí neodpovídá certifikátu → 400 invalid_certificate, nic se nezmění', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    const response = await uploadCertificate(app, 'production');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { type: 'invalid_certificate', message: 'Certifikát je vydán pro prostředí playground, ne pro zvolené prostředí production.' },
    });
    expect((await app.inject('/api/v1/status')).json()).toMatchObject({ environment: 'playground' });
  });

  it('certifikát jiného prostředí prostředí přepne, tržby pak jdou do něj', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    certificateEnvironment = 'production';
    expect((await uploadCertificate(app, 'production')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/status')).json()).toMatchObject({ environment: 'production' });

    eetResponses.push(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await app.inject({ method: 'POST', url: '/api/v1/sales', payload: { ...sale, environment: 'production' } });
    expect(eetCalls).toEqual(['https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4']);
  });
});

describe('POST /api/v1/sales', () => {
  it('odešle tržbu a vrátí accepted s POK; status ukáže poslední úspěch', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    eetResponses.push(() => new Response(readFixture('responses/accepted.xml'), { headers: { 'X-Global-Transaction-Id': 'gt-1' } }));

    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload: sale });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      result: 'accepted',
      pok: 'f527b0bb-6534-474e-ab3f-986a62bc3e1a-ff',
      prvni_zaslani: true,
      test: true,
      signature_valid: true,
      global_transaction_id: 'gt-1',
    });
    expect((await app.inject('/api/v1/status')).json()).toMatchObject({ last_success_at: NOW.toISOString() });
  });

  it('dočasná chyba → retry; status ukáže poslední chybu', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    eetResponses.push(() => new Response('<html>Bad gateway</html>', { status: 502 }));

    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload: sale });
    expect(response.json()).toMatchObject({ result: 'retry', error: { type: 'http' } });
    expect((await app.inject('/api/v1/status')).json()).toMatchObject({
      last_error: { at: NOW.toISOString(), message: 'http: EET vrátil HTTP 502 bez platné odpovědi.' },
    });
  });

  it('tržba pro jiné prostředí, než je certifikát → 409 environment_mismatch, nic se neodešle', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload: { ...sale, environment: 'production' } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        type: 'environment_mismatch',
        message: 'Tržba patří do prostředí production, nahraný certifikát je pro prostředí playground.',
      },
    });
    expect(eetCalls).toEqual([]);
  });

  it.each([
    ['chybějící položka', { ...sale, data: { ...sale.data, celk_trzba: undefined } }],
    ['chybějící prostředí', { prvni_zaslani: true, data: sale.data }],
    ['neznámá položka', { ...sale, data: { ...sale.data, dic_popl: 'CZ1' } }],
    ['chybějící prvni_zaslani', { environment: 'playground', data: sale.data }],
    ['neplatný formát částky', { ...sale, data: { ...sale.data, celk_trzba: '1.0' } }],
  ])('neplatná data (%s) → HTTP 200 rejected validation, nic se neodešle', async (_label, payload) => {
    const app = await createApp();
    await uploadCertificate(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: 'rejected', error: { type: 'validation' } });
    expect(eetCalls).toEqual([]);
  });

  it('prošlý certifikát → 503 a /healthy hlásí chybu', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    now = new Date('2027-01-03T00:00:00Z');
    const response = await app.inject({ method: 'POST', url: '/api/v1/sales', payload: sale });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { type: 'no_certificate' } });
    expect((await app.inject('/healthy')).statusCode).toBe(503);
  });
});

describe('POST /api/v1/certificate/renew', () => {
  it('bez CA EET API → 409 renewal_unavailable', async () => {
    const app = await createApp();
    await uploadCertificate(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/certificate/renew' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { type: 'renewal_unavailable' } });
  });

  it('s CA EET API, ale bez certifikátu → 409 no_certificate', async () => {
    const app = await createApp({ ca: true });
    const response = await app.inject({ method: 'POST', url: '/api/v1/certificate/renew' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { type: 'no_certificate' } });
  });

  it('s CA EET API a certifikátem → 202, obnova běží na pozadí', async () => {
    const app = await createApp({ ca: true });
    await uploadCertificate(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/certificate/renew' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ certificate: { eic: 'CZ00000019' }, renewal: { automatic: true } });
  });
});

it('neznámý endpoint → 404 not_found', async () => {
  const app = await createApp();
  const response = await app.inject('/api/v1/nic');
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ error: { type: 'not_found' } });
});
