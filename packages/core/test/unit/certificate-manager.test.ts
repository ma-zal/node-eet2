import { beforeEach, describe, expect, it } from 'vitest';
import { CaEetApiError, type CaEetApi, type CaPkcs12, type CaRequestStatus } from '../../src/ca/ca-client.js';
import type { EetCredentials } from '../../src/certificate/credentials.js';
import { CertificateManager, MemoryCertificateStore, type CertificateManagerOptions } from '../../src/certificate/manager.js';
import { EetCertificateError } from '../../src/errors.js';
import { createTestIdentity, toLegacyPkcs12, type TestIdentity } from './helpers.js';

const PASSWORD = 'ABcd1234';
const HOUR = 3_600_000;

/** Falešná CA EET: zaznamenává volání a vrací naprogramované odpovědi. */
class FakeCa implements CaEetApi {
  calls: Array<{ operation: string; serial: string; reqId?: string }> = [];
  notFinished: string[] = [];
  statuses: CaRequestStatus[] = [{ reqId: 'req-1', state: 'ISSUED' }];
  issued: TestIdentity | undefined;
  failures: Partial<Record<keyof CaEetApi, Error>> = {};
  /** Volá se při potvrzení převzetí – např. pro kontrolu, co je v tu chvíli uložené. */
  onAck: (() => Promise<void>) | undefined;

  private record(operation: keyof CaEetApi, credentials: EetCredentials, reqId?: string): void {
    this.calls.push({ operation, serial: credentials.serial_number, ...(reqId ? { reqId } : {}) });
    const failure = this.failures[operation];
    if (failure) {
      delete this.failures[operation];
      throw failure;
    }
  }

  operations(): string[] {
    return this.calls.map((call) => call.operation);
  }

  async renew(credentials: EetCredentials) {
    this.record('renew', credentials);
    return { reqId: 'req-1' };
  }

  async getStatus(credentials: EetCredentials, reqId: string): Promise<CaRequestStatus> {
    this.record('getStatus', credentials, reqId);
    return this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0];
  }

  async claimDownload(credentials: EetCredentials, reqId: string): Promise<CaPkcs12> {
    this.record('claimDownload', credentials, reqId);
    if (!this.issued) throw new Error('Test nenastavil vydaný certifikát.');
    const issued = this.issued.credentials;
    return {
      pkcs12: toLegacyPkcs12(this.issued, PASSWORD),
      password: PASSWORD,
      certificate: { sn: issued.serial_number, validFrom: issued.valid_from, validTo: issued.valid_to, state: 'VALID' },
    };
  }

  async ackDownload(credentials: EetCredentials, reqId: string) {
    this.record('ackDownload', credentials, reqId);
    await this.onAck?.();
  }

  async getNotFinished(credentials: EetCredentials) {
    this.record('getNotFinished', credentials);
    return this.notFinished;
  }
}

// Původní certifikát platí 1. 1. 2026 – 2. 1. 2027, obnova je naplánovaná na 12. 12. 2026.
const original = createTestIdentity({ validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2027-01-02T00:00:00Z') });
const renewed = createTestIdentity({ validFrom: new Date('2026-12-12T00:00:00Z'), validTo: new Date('2027-12-13T00:00:00Z') });

let now: Date;
let ca: FakeCa;
let store: MemoryCertificateStore;
let sleeps: number[];

function createManager(overrides: Partial<CertificateManagerOptions> = {}): CertificateManager {
  return new CertificateManager({
    store,
    ca: { playground: ca },
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    detectEnvironment: () => 'playground',
    ...overrides,
  });
}

async function managerWithOriginal(): Promise<CertificateManager> {
  now = new Date('2026-06-01T00:00:00Z');
  const manager = createManager();
  await manager.load();
  await manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground');
  return manager;
}

beforeEach(() => {
  ca = new FakeCa();
  ca.issued = renewed;
  store = new MemoryCertificateStore();
  sleeps = [];
});

describe('CertificateManager – nahrání certifikátu', () => {
  it('nahraje certifikát a naplánuje obnovu 21 dní před koncem platnosti', async () => {
    const manager = await managerWithOriginal();
    expect(manager.getStatus()).toEqual({
      environment: 'playground',
      certificate: {
        eic: 'CZ00000019',
        serial_number: original.credentials.serial_number,
        valid_from: '2026-01-01T00:00:00.000Z',
        valid_to: '2027-01-02T00:00:00.000Z',
        days_left: 215,
        installed_at: '2026-06-01T00:00:00.000Z',
        source: 'upload',
      },
      renewal: { state: 'scheduled', automatic: true, scheduled_at: '2026-12-12T00:00:00.000Z' },
    });
    expect(manager.getCredentials()?.serial_number).toBe(original.credentials.serial_number);
    expect((await store.load())?.current?.key_pem).toContain('PRIVATE KEY');
  });

  it('odmítne certifikát z jiného prostředí', async () => {
    now = new Date('2026-06-01T00:00:00Z');
    const manager = createManager({ detectEnvironment: () => 'production' });
    await manager.load();
    await expect(manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground')).rejects.toThrow(
      'Certifikát je vydán pro prostředí production, ne pro zvolené prostředí playground.',
    );
    expect(manager.getEnvironment()).toBeUndefined();
  });

  it('nahrání certifikátu z jiného prostředí přepne prostředí i automatickou obnovu', async () => {
    now = new Date('2026-06-01T00:00:00Z');
    const isRenewed = (credentials: EetCredentials) => credentials.serial_number === renewed.credentials.serial_number;
    const manager = createManager({ detectEnvironment: (credentials) => (isRenewed(credentials) ? 'production' : 'playground') });
    await manager.load();
    expect(manager.getEnvironment()).toBeUndefined();
    await manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground');
    expect(manager.getEnvironment()).toBe('playground');
    expect(manager.getStatus().renewal.automatic).toBe(true);

    now = new Date('2026-12-20T00:00:00Z');
    await manager.installPkcs12(toLegacyPkcs12(renewed, PASSWORD), PASSWORD, 'production');
    expect(manager.getEnvironment()).toBe('production');
    expect(manager.getStatus().environment).toBe('production');
    // CA EET API je v testu jen pro playground
    expect(manager.getStatus().renewal.automatic).toBe(false);
  });

  it('po načtení z úložiště zná prostředí uloženého certifikátu', async () => {
    await managerWithOriginal();
    const reloaded = createManager();
    await reloaded.load();
    expect(reloaded.getEnvironment()).toBe('playground');
    expect(reloaded.getStatus().environment).toBe('playground');
  });

  it('odmítne certifikát, který nevydala CA EET', async () => {
    now = new Date('2026-06-01T00:00:00Z');
    const manager = createManager({ detectEnvironment: undefined });
    await manager.load();
    await expect(manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground')).rejects.toThrow(EetCertificateError);
  });

  it('odmítne certifikát mimo dobu platnosti a chybné heslo', async () => {
    now = new Date('2027-02-01T00:00:00Z');
    const manager = createManager();
    await manager.load();
    await expect(manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground')).rejects.toThrow(/není platný/);
    await expect(manager.installPkcs12(toLegacyPkcs12(renewed, PASSWORD), 'spatne11', 'playground')).rejects.toThrow(EetCertificateError);
    expect(manager.getStatus().certificate).toBeUndefined();
  });

  it('nové nahrání přesune dosavadní certifikát do previous', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-20T00:00:00Z');
    await manager.installPkcs12(toLegacyPkcs12(renewed, PASSWORD), PASSWORD, 'playground');
    const state = await store.load();
    expect(state?.current?.serial_number).toBe(renewed.credentials.serial_number);
    expect(state?.previous?.serial_number).toBe(original.credentials.serial_number);
  });
});

describe('CertificateManager – automatická obnova', () => {
  it('před termínem CA nevolá', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-11T23:59:59Z');
    await manager.checkRenewal();
    expect(ca.calls).toEqual([]);
  });

  it('v termínu podá žádost, počká na vydání, nainstaluje nový certifikát a potvrdí převzetí', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.statuses = [
      { reqId: 'req-1', state: 'INPROCESS', pollAfterSeconds: 2 },
      { reqId: 'req-1', state: 'ISSUED' },
    ];

    const status = await manager.checkRenewal();

    expect(ca.operations()).toEqual(['getNotFinished', 'renew', 'getStatus', 'getStatus', 'claimDownload', 'ackDownload']);
    // Celá žádost se autentizuje obnovovaným (původním) certifikátem.
    expect(new Set(ca.calls.map((call) => call.serial))).toEqual(new Set([original.credentials.serial_number]));
    expect(sleeps).toEqual([2000]);
    expect(status).toMatchObject({
      certificate: { serial_number: renewed.credentials.serial_number, source: 'renewal', valid_to: '2027-12-13T00:00:00.000Z' },
      renewal: { state: 'scheduled', scheduled_at: '2027-11-22T00:00:00.000Z' },
    });
    const state = await store.load();
    expect(state?.previous?.serial_number).toBe(original.credentials.serial_number);
    expect(state?.renewal).toBeUndefined();
  });

  it('nový certifikát je uložený dřív, než se potvrdí převzetí (pád procesu ho neztratí)', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    let storedAtAck: string | undefined;
    ca.onAck = async () => {
      storedAtAck = (await store.load())?.current?.serial_number;
    };
    await manager.checkRenewal();
    expect(storedAtAck).toBe(renewed.credentials.serial_number);
  });

  it('naváže na rozběhnutou žádost v CA místo podání nové', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.notFinished = ['req-0'];
    await manager.checkRenewal();
    expect(ca.operations()).not.toContain('renew');
    expect(ca.calls.find((call) => call.operation === 'ackDownload')?.reqId).toBe('req-0');
  });

  it('po chybě mezi instalací a potvrzením převzetí obnovu dokončí bez druhé instalace', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.failures.ackDownload = new CaEetApiError('Síťová chyba při volání CA EET: fetch failed', 'network');

    const failed = await manager.checkRenewal();
    expect(failed.renewal).toMatchObject({
      state: 'failed',
      req_id: 'req-1',
      next_attempt_at: '2026-12-13T09:00:00.000Z',
      last_error: { message: 'Síťová chyba při volání CA EET: fetch failed' },
    });
    expect(failed.certificate?.serial_number).toBe(renewed.credentials.serial_number);
    const installedAt = failed.certificate?.installed_at;

    // Restart služby: nový manager nad stejným úložištěm.
    now = new Date('2026-12-13T09:00:00Z');
    ca.calls = [];
    ca.statuses = [{ reqId: 'req-1', state: 'DELIVERING' }];
    const restarted = createManager();
    await restarted.load();
    const done = await restarted.checkRenewal();

    expect(ca.operations()).toEqual(['getStatus', 'claimDownload', 'ackDownload']);
    expect(new Set(ca.calls.map((call) => call.serial))).toEqual(new Set([original.credentials.serial_number]));
    expect(done.certificate?.installed_at).toBe(installedAt);
    expect(done.renewal.state).toBe('scheduled');
  });

  it('zamítnutá žádost → failed, další pokus až za 24 h', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.statuses = [{ reqId: 'req-1', state: 'REJECTED', rejectedReason: 'Selhání kontroly parametrů žádosti' }];

    const status = await manager.checkRenewal();
    expect(status.renewal).toMatchObject({
      state: 'failed',
      next_attempt_at: '2026-12-14T08:00:00.000Z',
      last_error: { message: 'CA EET žádost o obnovu zamítla: Selhání kontroly parametrů žádosti' },
    });
    expect(status.renewal.req_id).toBeUndefined();

    ca.calls = [];
    now = new Date('2026-12-13T20:00:00Z');
    await manager.checkRenewal();
    expect(ca.calls).toEqual([]);

    now = new Date('2026-12-14T08:00:00Z');
    ca.statuses = [{ reqId: 'req-1', state: 'ISSUED' }];
    expect((await manager.checkRenewal()).renewal.state).toBe('scheduled');
  });

  it('síťová chyba → další pokus za 1 h, 429 → podle Retry-After', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.failures.getNotFinished = new CaEetApiError('Síťová chyba', 'network');
    expect((await manager.checkRenewal()).renewal.next_attempt_at).toBe(new Date(now.getTime() + HOUR).toISOString());

    now = new Date('2026-12-13T09:00:00Z');
    ca.failures.renew = new CaEetApiError('CA EET vrátila HTTP 429.', 'http', 429, 6, 120);
    expect((await manager.checkRenewal()).renewal.next_attempt_at).toBe('2026-12-13T09:02:00.000Z');
  });

  it('žádost, kterou CA v jednom běhu nevyřídí, zkontroluje znovu za 15 min bez chyby', async () => {
    await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.statuses = [{ reqId: 'req-1', state: 'INPROCESS', pollAfterSeconds: 60 }];
    const sleepingManager = createManager({
      sleep: async (ms) => {
        now = new Date(now.getTime() + ms);
      },
    });
    await sleepingManager.load();

    const status = await sleepingManager.checkRenewal();
    expect(status.renewal).toMatchObject({ state: 'in_progress', req_id: 'req-1', ca_state: 'INPROCESS' });
    expect(status.renewal.last_error).toBeUndefined();
    expect(Date.parse(status.renewal.next_attempt_at!) - now.getTime()).toBe(15 * 60_000);
  });

  it('obnovený certifikát s jiným EIČ odmítne', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.issued = createTestIdentity({ commonName: 'CZ683555118', validFrom: new Date('2026-12-12T00:00:00Z') });

    const status = await manager.checkRenewal();
    expect(status.certificate?.serial_number).toBe(original.credentials.serial_number);
    expect(status.renewal.state).toBe('failed');
    expect(status.renewal.last_error?.message).toMatch(/jiné EIČ|EIČ CZ683555118/);
    expect(ca.operations()).not.toContain('ackDownload');
  });

  it('prošlý certifikát → expired, CA se nevolá', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2027-01-02T00:00:00Z');
    expect((await manager.checkRenewal()).renewal).toEqual({ state: 'expired', automatic: true });
    expect(ca.calls).toEqual([]);
  });

  it('bez CA EET API (playground) se obnova neplánuje', async () => {
    now = new Date('2026-06-01T00:00:00Z');
    const manager = createManager({ ca: undefined });
    await manager.load();
    await manager.installPkcs12(toLegacyPkcs12(original, PASSWORD), PASSWORD, 'playground');
    now = new Date('2026-12-20T00:00:00Z');
    expect((await manager.checkRenewal()).renewal).toEqual({ state: 'idle', automatic: false });
    await expect(manager.renewNow()).rejects.toThrow(/není k dispozici/);
  });

  it('ruční obnova proběhne i před termínem a přes prodlevu po chybě', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    ca.failures.getNotFinished = new CaEetApiError('Síťová chyba', 'network');
    await manager.checkRenewal();

    now = new Date('2026-12-13T08:05:00Z');
    const status = await manager.renewNow();
    expect(status.certificate?.serial_number).toBe(renewed.credentials.serial_number);
    expect(status.renewal.last_error).toBeUndefined();
  });

  it('souběžné kontroly podají jen jednu žádost', async () => {
    const manager = await managerWithOriginal();
    now = new Date('2026-12-13T08:00:00Z');
    await Promise.all([manager.checkRenewal(), manager.checkRenewal(), manager.checkRenewal()]);
    expect(ca.operations().filter((operation) => operation === 'renew')).toHaveLength(1);
  });
});
