import { describe, expect, it } from 'vitest';
import { formatEetDateTime } from '../../src/sale/datetime.js';

describe('formatEetDateTime', () => {
  it('zimní čas má offset +01:00', () => {
    expect(formatEetDateTime(new Date('2027-01-09T03:25:28Z'))).toBe('2027-01-09T04:25:28+01:00');
  });

  it('letní čas má offset +02:00', () => {
    expect(formatEetDateTime(new Date('2027-06-09T03:25:28Z'))).toBe('2027-06-09T05:25:28+02:00');
  });

  it('zahodí milisekundy', () => {
    expect(formatEetDateTime(new Date('2027-01-09T03:25:28.999Z'))).toBe('2027-01-09T04:25:28+01:00');
  });

  it('správně řeší přechod na letní čas', () => {
    expect(formatEetDateTime(new Date('2027-03-28T00:59:59Z'))).toBe('2027-03-28T01:59:59+01:00');
    expect(formatEetDateTime(new Date('2027-03-28T01:00:00Z'))).toBe('2027-03-28T03:00:00+02:00');
  });

  it('správně řeší přechod na zimní čas', () => {
    expect(formatEetDateTime(new Date('2027-10-31T00:59:59Z'))).toBe('2027-10-31T02:59:59+02:00');
    expect(formatEetDateTime(new Date('2027-10-31T01:00:00Z'))).toBe('2027-10-31T02:00:00+01:00');
  });

  it('půlnoc je 00, ne 24', () => {
    expect(formatEetDateTime(new Date('2027-01-08T23:00:00Z'))).toBe('2027-01-09T00:00:00+01:00');
  });

  it('odmítne neplatné datum', () => {
    expect(() => formatEetDateTime(new Date('nesmysl'))).toThrow(RangeError);
  });
});
