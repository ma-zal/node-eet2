import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CertificateState } from 'eet2-core';
import { FileCertificateStore } from '../src/file-certificate-store.js';
import { createTestIdentity } from '../../core/test/unit/helpers.js';

const current = { ...createTestIdentity().credentials, installed_at: '2026-06-01T00:00:00.000Z', source: 'upload' as const };
const previous = { ...createTestIdentity().credentials, installed_at: '2025-06-01T00:00:00.000Z', source: 'upload' as const };
const state: CertificateState = {
  version: 1,
  current,
  previous,
  renewal: { req_id: 'req-1', started_at: '2026-12-12T00:00:00.000Z', renewing_serial_number: current.serial_number },
};

function tempFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'eet2-store-')), 'certificate.json');
}

describe('FileCertificateStore', () => {
  it('neexistující soubor → undefined', async () => {
    expect(await new FileCertificateStore(tempFile()).load()).toBeUndefined();
  });

  it('uloží a načte stav, soubor má oprávnění 0600', async () => {
    const file = tempFile();
    const store = new FileCertificateStore(file);
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('s passphrase uloží klíče šifrovaně a načte je zpět v čitelné podobě', async () => {
    const file = tempFile();
    const store = new FileCertificateStore(file, 'tajne-heslo');
    await store.save(state);

    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');
    expect(onDisk).not.toContain('-----BEGIN PRIVATE KEY-----');

    const loaded = await store.load();
    expect(loaded?.current?.key_pem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(loaded?.previous?.key_pem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(loaded?.renewal).toEqual(state.renewal);
  });

  it('šifrovaný klíč bez passphrase nebo s chybnou passphrase → srozumitelná chyba', async () => {
    const file = tempFile();
    await new FileCertificateStore(file, 'tajne-heslo').save(state);
    await expect(new FileCertificateStore(file).load()).rejects.toThrow(/nastavte proměnnou prostředí EET2_KEY_PASSPHRASE/);
    await expect(new FileCertificateStore(file, 'jine-heslo').load()).rejects.toThrow(/nejde dešifrovat/);
  });
});
