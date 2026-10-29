// Integrační test proti playground EET (síť). Spouští se z kořene repozitáře přes `npm run test:playground`,
// který nejdřív stáhne oficiální testovací certifikáty do .fixtures/playground/.
// Pozor: playground má servisní okno zpravidla každý čtvrtek 20:00–6:00.
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EetClient, detectCertificateEnvironment, loadPkcs12, type EetCredentials, type SaleData } from '../../src/index.js';

const FIXTURES_DIR = new URL('../../../../.fixtures/playground/', import.meta.url);
const IDENTITY = 'CZ683555118';

let credentials: EetCredentials;

beforeAll(() => {
  const passwordFile = new URL('password_pokladni_cert_playground.txt', FIXTURES_DIR);
  if (!existsSync(passwordFile)) {
    throw new Error('Chybí testovací certifikáty. Spusťte z kořene repozitáře `npm run test:playground`.');
  }
  const password = readFileSync(passwordFile, 'utf8').trim();
  credentials = loadPkcs12(readFileSync(new URL(`CA_EET-Playground-${IDENTITY}.p12`, FIXTURES_DIR)), password);
});

function uniqueSale(): SaleData {
  return {
    id_jednotky: 21,
    id_pokl: 'NODE-EET2-TEST',
    porad_cis: `T${Date.now()}`,
    dat_trzby: new Date(),
    celk_trzba: '123.45',
  };
}

describe('playground EET', () => {
  const client = new EetClient({ environment: 'playground' });

  it('oficiální testovací certifikát je z CA EET pro playground', () => {
    expect(credentials.eic).toBe(IDENTITY);
    expect(detectCertificateEnvironment(credentials)).toBe('playground');
  });

  it('přijme tržbu, vrátí fiktivní POK a platný podpis; opakované zaslání projde také', async () => {
    const data = uniqueSale();

    const first = await client.sendSale({ data, prvni_zaslani: true }, credentials);
    expect(first).toMatchObject({ result: 'accepted', test: true, signature_valid: true, warnings: [] });
    expect(first.result === 'accepted' && first.pok).toMatch(/-ff$/);

    const repeated = await client.sendSale({ data, prvni_zaslani: false }, credentials);
    expect(repeated).toMatchObject({ result: 'accepted', prvni_zaslani: false, test: true });
    expect(repeated.uuid_zpravy).not.toBe(first.uuid_zpravy);
  });

  it('ověřovací mód vrátí verified', async () => {
    const result = await client.sendSale({ data: uniqueSale(), prvni_zaslani: true, overeni: true }, credentials);
    expect(result).toMatchObject({ result: 'verified', test: true });
  });
});
