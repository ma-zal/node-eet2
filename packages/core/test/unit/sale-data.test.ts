import { describe, expect, it } from 'vitest';
import { normalizeSaleData, type SaleData } from '../../src/sale/sale-data.js';

const valid: SaleData = {
  id_jednotky: 181,
  id_pokl: '00/2535/CN58',
  porad_cis: '#25/c-12/1A_2/2027',
  dat_trzby: '2027-01-07T21:01:00Z',
  celk_trzba: '87988.00',
};

function errorsOf(data: Partial<SaleData>): string[] {
  const result = normalizeSaleData({ ...valid, ...data } as SaleData, 'CZ00000019');
  return result.ok ? [] : result.errors;
}

describe('normalizeSaleData', () => {
  it('doplní EIČ z certifikátu a převede čas na Prahu', () => {
    const result = normalizeSaleData(valid, 'CZ00000019');
    expect(result).toEqual({
      ok: true,
      data: {
        eic_popl: 'CZ00000019',
        id_jednotky: 181,
        id_pokl: '00/2535/CN58',
        porad_cis: '#25/c-12/1A_2/2027',
        dat_trzby: '2027-01-07T22:01:00+01:00',
        celk_trzba: '87988.00',
      },
    });
  });

  it('zachová volitelné položky a explicitní EIČ', () => {
    const result = normalizeSaleData(
      {
        ...valid,
        eic_popl: 'CZ8551015704',
        eic_poverujiciho: 'CZ00000019',
        povereni_vice_popl: true,
        urceno_cerp_zuct: '343.00',
        cerp_zuct: '-237.00',
        dat_trzby: new Date('2027-01-07T21:01:00Z'),
      },
      'CZ683555118',
    );
    expect(result.ok && result.data).toMatchObject({
      eic_popl: 'CZ8551015704',
      eic_poverujiciho: 'CZ00000019',
      povereni_vice_popl: true,
      urceno_cerp_zuct: '343.00',
      cerp_zuct: '-237.00',
      dat_trzby: '2027-01-07T22:01:00+01:00',
    });
  });

  it.each(['250.00', '-187.20', '0.56', '0.00', '-0.01', '99999999.99', '-99999999.99'])('přijme částku %s', (celk_trzba) => {
    expect(errorsOf({ celk_trzba })).toEqual([]);
  });

  it.each(['020.45', '00010.25', '-0.00', '-00.00', '.20', '-00100.00', '1.0', '1', '100000000.00', '1,00', ''])(
    'odmítne částku "%s"',
    (celk_trzba) => {
      expect(errorsOf({ celk_trzba })).toHaveLength(1);
    },
  );

  it('odmítne čas bez časové zóny (byl by závislý na zóně serveru)', () => {
    expect(errorsOf({ dat_trzby: '2027-01-07T21:01:00' })).toHaveLength(1);
  });

  it('odmítne neplatné hodnoty a vrátí všechny chyby najednou', () => {
    const errors = errorsOf({
      eic_popl: 'CZ123',
      id_jednotky: 0,
      id_pokl: 'pokladna č. 1',
      porad_cis: '12345678901234567890123456',
    });
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toContain('eic_popl');
    expect(errors.join(' ')).toContain('id_jednotky');
    expect(errors.join(' ')).toContain('id_pokl');
    expect(errors.join(' ')).toContain('porad_cis');
  });

  it('odmítne prázdné volitelné položky', () => {
    expect(errorsOf({ eic_poverujiciho: '' })).toHaveLength(1);
    expect(errorsOf({ cerp_zuct: '' })).toHaveLength(1);
  });
});
