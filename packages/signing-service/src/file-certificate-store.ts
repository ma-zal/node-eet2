import { createPrivateKey } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { CertificateState, CertificateStore, StoredCertificate } from 'eet2-core';

const ENCRYPTED_KEY_MARKER = '-----BEGIN ENCRYPTED PRIVATE KEY-----';

/**
 * Ukládá stav certifikátu do JSON souboru (ADR-007): atomicky (dočasný soubor + rename), s oprávněním 0600.
 * Souběžné zápisy nehrozí – `CertificateManager` volá úložiště sériově.
 *
 * Pokud je zadaná passphrase, privátní klíče se ukládají jako šifrovaný PKCS#8 (AES-256-CBC).
 * V paměti jsou vždy nešifrované.
 */
export class FileCertificateStore implements CertificateStore {
  constructor(
    private readonly filePath: string,
    private readonly passphrase?: string,
  ) {}

  get keyEncrypted(): boolean {
    return this.passphrase !== undefined;
  }

  async load(): Promise<CertificateState | undefined> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    let state: CertificateState;
    try {
      state = JSON.parse(text) as CertificateState;
    } catch {
      throw new Error(`Soubor ${this.filePath} není platný JSON.`);
    }
    if (state.version !== 1) {
      throw new Error(`Soubor ${this.filePath} má nepodporovanou verzi ${String(state.version)}.`);
    }
    return {
      ...state,
      ...this.mapCertificates(state, (certificate) => this.decrypt(certificate)),
    };
  }

  async save(state: CertificateState): Promise<void> {
    const stored: CertificateState = {
      ...state,
      ...this.mapCertificates(state, (certificate) => this.encrypt(certificate)),
    };
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  private mapCertificates(
    state: CertificateState,
    map: (certificate: StoredCertificate) => StoredCertificate,
  ): Pick<CertificateState, 'current' | 'previous'> {
    return {
      ...(state.current ? { current: map(state.current) } : {}),
      ...(state.previous ? { previous: map(state.previous) } : {}),
    };
  }

  private encrypt(certificate: StoredCertificate): StoredCertificate {
    if (this.passphrase === undefined) {
      return certificate;
    }
    const key_pem = createPrivateKey(certificate.key_pem)
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: this.passphrase })
      .toString();
    return { ...certificate, key_pem };
  }

  private decrypt(certificate: StoredCertificate): StoredCertificate {
    if (!certificate.key_pem.includes(ENCRYPTED_KEY_MARKER)) {
      return certificate;
    }
    if (this.passphrase === undefined) {
      throw new Error(`Privátní klíč v ${this.filePath} je šifrovaný – nastavte proměnnou prostředí EET2_KEY_PASSPHRASE.`);
    }
    let key_pem: string;
    try {
      key_pem = createPrivateKey({ key: certificate.key_pem, format: 'pem', passphrase: this.passphrase })
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
    } catch {
      throw new Error(`Privátní klíč v ${this.filePath} nejde dešifrovat – zkontrolujte EET2_KEY_PASSPHRASE.`);
    }
    return { ...certificate, key_pem };
  }
}
