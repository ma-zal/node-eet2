import { createHash, createVerify, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CaEetApiError, CaEetClient } from '../../src/ca/ca-client.js';
import { createCaJwt } from '../../src/ca/jwt.js';
import { createTestIdentity } from './helpers.js';

const { credentials } = createTestIdentity();
const now = new Date('2026-12-13T10:00:00Z');

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('createCaJwt', () => {
  it('má profil dle CA EET a je podepsaný certifikátem', () => {
    const [header, payload, signature] = createCaJwt(credentials, now).split('.');

    const expectedThumbprint = createHash('sha256').update(new X509Certificate(credentials.cert_pem).raw).digest('base64url');
    expect(decodePart(header)).toEqual({ alg: 'RS256', typ: 'JWT', 'x5t#S256': expectedThumbprint });

    const { iat, exp } = decodePart(payload) as { iat: number; exp: number };
    expect(iat).toBeLessThanOrEqual(now.getTime() / 1000);
    expect(exp).toBeGreaterThan(now.getTime() / 1000);
    expect(exp - iat).toBeLessThanOrEqual(300);

    const valid = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(credentials.cert_pem, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
  });
});

interface Call {
  url: string;
  method: string;
  authorization: string;
}

function clientWith(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const headers = init?.headers as Record<string, string>;
    const call = { url: String(url), method: String(init?.method), authorization: headers.Authorization };
    calls.push(call);
    return responder(call);
  };
  return { client: new CaEetClient({ baseUrl: 'https://ca.test.caeet.gov.cz/api/', fetch, now: () => now }), calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('CaEetClient', () => {
  it('renew – POST s JWT, vrátí reqId', async () => {
    const { client, calls } = clientWith(() => json(201, { reqId: 'req-1' }));
    expect(await client.renew(credentials)).toEqual({ reqId: 'req-1' });
    expect(calls[0]).toMatchObject({ url: 'https://ca.test.caeet.gov.cz/api/request/renew', method: 'POST' });
    expect(calls[0].authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('status – INPROCESS s pollAfterSeconds a REJECTED s důvodem', async () => {
    const inProcess = clientWith(() => json(200, { reqId: 'req-1', state: 'INPROCESS', pollAfterSeconds: 3 }));
    expect(await inProcess.client.getStatus(credentials, 'req-1')).toEqual({ reqId: 'req-1', state: 'INPROCESS', pollAfterSeconds: 3 });
    expect(inProcess.calls[0]).toMatchObject({ url: 'https://ca.test.caeet.gov.cz/api/request/req-1/status', method: 'GET' });

    const rejected = clientWith(() => json(200, { reqId: 'req-1', state: 'REJECTED', rejectedReason: 'Selhání kontroly' }));
    expect(await rejected.client.getStatus(credentials, 'req-1')).toEqual({
      reqId: 'req-1',
      state: 'REJECTED',
      rejectedReason: 'Selhání kontroly',
    });
  });

  it('claim-download – dekóduje PKCS#12 z base64', async () => {
    const certificate = { sn: '123', validFrom: '2026-12-13 10:00:00+00:00', validTo: '2027-12-14 10:00:00+00:00', state: 'VALID' };
    const { client } = clientWith(() => json(200, { pkcs12: Buffer.from('obsah').toString('base64'), password: 'ABcd1234', certificate }));
    const result = await client.claimDownload(credentials, 'req-1');
    expect(result.pkcs12.toString()).toBe('obsah');
    expect(result).toMatchObject({ password: 'ABcd1234', certificate });
  });

  it('ack-download – 204 bez těla', async () => {
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
    await expect(client.ackDownload(credentials, 'req-1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ url: 'https://ca.test.caeet.gov.cz/api/request/req-1/ack-download', method: 'POST' });
  });

  it('not-finished – vrátí seznam reqId', async () => {
    const { client } = clientWith(() => json(200, { count: 2, data: ['req-1', 'req-2'] }));
    expect(await client.getNotFinished(credentials)).toEqual(['req-1', 'req-2']);
  });

  it('429 – chyba s Retry-After', async () => {
    const { client } = clientWith(() => json(429, { code: 6, message: 'Too many requests.' }, { 'Retry-After': '120' }));
    const error = await client.renew(credentials).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CaEetApiError);
    expect(error).toMatchObject({ kind: 'http', status: 429, code: 6, retryAfterSeconds: 120 });
  });

  it('401 – zpráva z ErrorDTO', async () => {
    const { client } = clientWith(() => json(401, { code: 2, message: 'Unauthorized access.', additionalInfo: 'Certifikát neplatný' }));
    await expect(client.renew(credentials)).rejects.toThrow('CA EET vrátila HTTP 401: Unauthorized access. – Certifikát neplatný.');
  });

  it('síťová chyba a neplatná odpověď', async () => {
    const network = new CaEetClient({
      baseUrl: 'https://ca.test.caeet.gov.cz/api',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(network.renew(credentials)).rejects.toMatchObject({ kind: 'network' });

    const invalid = clientWith(() => new Response('<html/>', { status: 201 }));
    await expect(invalid.client.renew(credentials)).rejects.toMatchObject({ kind: 'invalid_response' });

    const unknownState = clientWith(() => json(200, { reqId: 'req-1', state: 'UNKNOWN' }));
    await expect(unknownState.client.getStatus(credentials, 'req-1')).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
