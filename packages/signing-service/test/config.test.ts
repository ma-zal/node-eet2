import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveCaApiUrl } from '../src/config.js';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'eet2-config-'));
}

function writeConfig(dir: string, content: string): void {
  writeFileSync(path.join(dir, 'config.cjs'), content);
}

describe('loadConfig', () => {
  it('chybějící adresář úložiště → chyba o nepřipojeném volume', () => {
    expect(() => loadConfig(path.join(tempDir(), 'neexistuje'))).toThrow(/není připojený volume/);
  });

  it('chybějící config.cjs se založí ze šablony s výchozími hodnotami', () => {
    const dir = tempDir();
    expect(loadConfig(dir)).toEqual({ requestTimeoutMs: 5000, renewBeforeDays: 21 });
    expect(existsSync(path.join(dir, 'config.cjs'))).toBe(true);
  });

  it('načte platnou konfiguraci', () => {
    const dir = tempDir();
    writeConfig(dir, 'module.exports = { requestTimeoutMs: 3000 };');
    expect(loadConfig(dir)).toEqual({ requestTimeoutMs: 3000 });
  });

  it('odmítne neznámé položky (i dřívější environment) a příliš krátký timeout', () => {
    const dir = tempDir();
    writeConfig(dir, "module.exports = { environment: 'playground', requestTimeoutMs: 500 };");
    expect(() => loadConfig(dir)).toThrow(/requestTimeoutMs/);
    expect(() => loadConfig(dir)).toThrow(/environment/);
  });
});

describe('resolveCaApiUrl', () => {
  it('produkce má výchozí CA EET API, playground žádné', () => {
    expect(resolveCaApiUrl({}, 'production')).toBe('https://ca.caeet.gov.cz/api');
    expect(resolveCaApiUrl({}, 'playground')).toBeUndefined();
  });

  it('caApiUrl přepíše výchozí adresu, null obnovu vypne', () => {
    expect(resolveCaApiUrl({ caApiUrl: 'https://ca.test.caeet.gov.cz/api' }, 'playground')).toBe('https://ca.test.caeet.gov.cz/api');
    expect(resolveCaApiUrl({ caApiUrl: null }, 'production')).toBeUndefined();
  });
});
