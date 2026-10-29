import { formatEetDateTime } from './datetime.js';

/**
 * Data tržby. Položky odpovídají 1:1 atributům elementu `<Data>` (XSD `TrzbaDataType`),
 * názvy jsou převzaté doslova z rozhraní EET.
 */
export interface SaleData {
  /** EIČ poplatníka. Pokud chybí, použije se EIČ z pokladního certifikátu. */
  eic_popl?: string;
  /** EIČ pověřujícího poplatníka (evidence v pověření). */
  eic_poverujiciho?: string;
  /** Tržba je evidována v pověření za více poplatníků. */
  povereni_vice_popl?: boolean;
  /** Označení evidenční jednotky přidělené v DIS+ (1–999 999 999). */
  id_jednotky: number;
  /** Označení pokladního zařízení (1–20 znaků). */
  id_pokl: string;
  /** Pořadové číslo tržby (1–25 znaků). */
  porad_cis: string;
  /**
   * Okamžik uskutečnění tržby: `Date` nebo ISO 8601 řetězec s časovou zónou
   * (`Z` nebo `±hh:mm`). Do zprávy se zapíše jako čas v Praze.
   */
  dat_trzby: string | Date;
  /** Celková částka tržby v Kč jako řetězec s právě dvěma desetinnými místy, např. `"350.00"`. */
  celk_trzba: string;
  /** Celková částka plateb určená k následnému čerpání nebo zúčtování. */
  urceno_cerp_zuct?: string;
  /** Celková částka plateb, které jsou následným čerpáním nebo zúčtováním platby. */
  cerp_zuct?: string;
}

/** Data tržby po validaci, ve tvaru, v jakém se zapíší do XML zprávy. */
export interface NormalizedSaleData extends Omit<SaleData, 'eic_popl' | 'dat_trzby'> {
  eic_popl: string;
  dat_trzby: string;
}

export type NormalizeSaleDataResult = { ok: true; data: NormalizedSaleData } | { ok: false; errors: string[] };

// Masky datových formátů dle XSD a technické specifikace (kap. 3.3.3).
const EIC_PATTERN = /^CZ[0-9]{8,10}$/;
const STRING20_PATTERN = /^[0-9a-zA-Z.,:;\/#\-_ ]{1,20}$/;
const STRING25_PATTERN = /^[0-9a-zA-Z.,:;\/#\-_ ]{1,25}$/;
const AMOUNT_PATTERN = /^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Zvaliduje data tržby proti pravidlům XSD a převede je do tvaru pro XML.
 * Při chybě vrátí seznam všech nalezených problémů (česky).
 *
 * @param defaultEic EIČ z pokladního certifikátu, použije se, pokud `eic_popl` chybí.
 */
export function normalizeSaleData(data: SaleData, defaultEic: string): NormalizeSaleDataResult {
  const errors: string[] = [];

  const eicPopl = data.eic_popl ?? defaultEic;
  if (!EIC_PATTERN.test(eicPopl)) {
    errors.push(`eic_popl musí mít tvar CZ a 8 až 10 číslic (zadáno "${eicPopl}").`);
  }
  if (data.eic_poverujiciho !== undefined && !EIC_PATTERN.test(data.eic_poverujiciho)) {
    errors.push(`eic_poverujiciho musí mít tvar CZ a 8 až 10 číslic (zadáno "${data.eic_poverujiciho}").`);
  }
  if (data.povereni_vice_popl !== undefined && typeof data.povereni_vice_popl !== 'boolean') {
    errors.push('povereni_vice_popl musí být true nebo false.');
  }
  if (!Number.isInteger(data.id_jednotky) || data.id_jednotky < 1 || data.id_jednotky > 999_999_999) {
    errors.push(`id_jednotky musí být celé číslo 1 až 999 999 999 (zadáno "${data.id_jednotky}").`);
  }
  if (typeof data.id_pokl !== 'string' || !STRING20_PATTERN.test(data.id_pokl)) {
    errors.push(`id_pokl musí mít 1 až 20 znaků z množiny 0-9 a-z A-Z . , : ; / # - _ mezera (zadáno "${data.id_pokl}").`);
  }
  if (typeof data.porad_cis !== 'string' || !STRING25_PATTERN.test(data.porad_cis)) {
    errors.push(`porad_cis musí mít 1 až 25 znaků z množiny 0-9 a-z A-Z . , : ; / # - _ mezera (zadáno "${data.porad_cis}").`);
  }

  const datTrzby = normalizeDateTime(data.dat_trzby);
  if (datTrzby === undefined) {
    errors.push(`dat_trzby musí být platné datum a čas ve formátu ISO 8601 s časovou zónou (zadáno "${String(data.dat_trzby)}").`);
  }

  checkAmount('celk_trzba', data.celk_trzba, errors);
  if (data.urceno_cerp_zuct !== undefined) {
    checkAmount('urceno_cerp_zuct', data.urceno_cerp_zuct, errors);
  }
  if (data.cerp_zuct !== undefined) {
    checkAmount('cerp_zuct', data.cerp_zuct, errors);
  }

  if (errors.length > 0 || datTrzby === undefined) {
    return { ok: false, errors };
  }

  const normalized: NormalizedSaleData = {
    eic_popl: eicPopl,
    id_jednotky: data.id_jednotky,
    id_pokl: data.id_pokl,
    porad_cis: data.porad_cis,
    dat_trzby: datTrzby,
    celk_trzba: data.celk_trzba,
  };
  if (data.eic_poverujiciho !== undefined) normalized.eic_poverujiciho = data.eic_poverujiciho;
  if (data.povereni_vice_popl !== undefined) normalized.povereni_vice_popl = data.povereni_vice_popl;
  if (data.urceno_cerp_zuct !== undefined) normalized.urceno_cerp_zuct = data.urceno_cerp_zuct;
  if (data.cerp_zuct !== undefined) normalized.cerp_zuct = data.cerp_zuct;
  return { ok: true, data: normalized };
}

function normalizeDateTime(value: string | Date): string | undefined {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' && ISO_INSTANT_PATTERN.test(value)) {
    date = new Date(value);
  } else {
    return undefined;
  }
  return Number.isNaN(date.getTime()) ? undefined : formatEetDateTime(date);
}

function checkAmount(name: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) {
    errors.push(
      `${name} musí být částka s právě dvěma desetinnými místy, bez nevýznamných nul, v absolutní hodnotě pod 100 mil. Kč (zadáno "${String(value)}").`,
    );
  }
}
