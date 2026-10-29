import { describe, expect, it } from 'vitest';
import { verifyResponseSignature } from '../../src/soap/verify.js';
import { readFixture } from './helpers.js';

// Podpisový certifikát ve fixture platí od 8. 6. 2026 do 8. 6. 2027.
const capturedAt = new Date('2026-10-29T18:25:32Z');

describe('verifyResponseSignature', () => {
  it('přijme skutečný podpis z playground', () => {
    expect(verifyResponseSignature(readFixture('responses/accepted.xml'), capturedAt)).toEqual({ valid: true });
    expect(verifyResponseSignature(readFixture('responses/warning.xml'), capturedAt)).toEqual({ valid: true });
  });

  it('odhalí změnu potvrzovacího kódu', () => {
    const tampered = readFixture('responses/accepted.xml').replace(
      'pok="f527b0bb-6534-474e-ab3f-986a62bc3e1a-ff"',
      'pok="00000000-6534-474e-ab3f-986a62bc3e1a-ff"',
    );
    expect(verifyResponseSignature(tampered, capturedAt)).toMatchObject({ valid: false, reason: 'XML podpis nesouhlasí' });
  });

  it('odmítne podpisový certifikát mimo dobu platnosti', () => {
    const result = verifyResponseSignature(readFixture('responses/accepted.xml'), new Date('2027-07-01T00:00:00Z'));
    expect(result.valid).toBe(false);
  });

  it('nepodepsaná odpověď není platná', () => {
    expect(verifyResponseSignature(readFixture('responses/rejected.xml'), capturedAt)).toMatchObject({ valid: false });
  });
});
