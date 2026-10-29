import type { Warning } from '../soap/response.js';

export type { Warning };

/**
 * Druh chyby:
 * - `eet` – EET vrátil chybovou zprávu (`<Chyba>`), vyplněn `kod`,
 * - `timeout` – EET neodpověděl do mezní doby odezvy,
 * - `network` – síťová chyba, spojení přerušeno,
 * - `http` – HTTP stav bez platné odpovědi EET,
 * - `soap_fault` – SOAP Fault,
 * - `invalid_response` – odpověď nelze zpracovat,
 * - `validation` – neplatná vstupní data, nic se neodeslalo.
 */
export type SendErrorType = 'eet' | 'timeout' | 'network' | 'http' | 'soap_fault' | 'invalid_response' | 'validation';

export interface SendError {
  type: SendErrorType;
  /** Kód chyby z `<Chyba kod>`, jen u `type: 'eet'`. */
  kod?: number;
  message: string;
}

/** Společná pole všech výsledků. Pole bez hodnoty se vynechávají. */
interface ResultBase {
  /** UUID odeslané zprávy. Chybí, pokud se nic neodeslalo (neplatná data). */
  uuid_zpravy?: string;
  dat_odesl?: string;
  prvni_zaslani?: boolean;
  /** Příznak neprodukčního prostředí z odpovědi. */
  test?: boolean;
  /** Hodnota hlavičky `X-Global-Transaction-Id` pro dohledání u podpory FS. */
  global_transaction_id?: string;
  duration_ms: number;
}

/** Tržba přijata, máme potvrzovací kód. */
export interface AcceptedResult extends ResultBase {
  result: 'accepted';
  uuid_zpravy: string;
  dat_odesl: string;
  prvni_zaslani: boolean;
  dat_prij?: string;
  pok: string;
  /** Výsledek ověření podpisu potvrzení. Neplatný podpis nemění `result` (ADR-006). */
  signature_valid: boolean;
  /** Důvod neplatnosti podpisu. */
  signature_error?: string;
  warnings: Warning[];
}

/** Trvalá chyba – opakování se stejnými daty nepomůže. */
export interface RejectedResult extends ResultBase {
  result: 'rejected';
  dat_odmit?: string;
  error: SendError;
}

/** Dočasná chyba – poslat znovu později s `prvni_zaslani=false`. */
export interface RetryResult extends ResultBase {
  result: 'retry';
  dat_odmit?: string;
  error: SendError;
}

/** Ověřovací mód: zprávu se podařilo zpracovat (kód 0), nic se neeviduje. */
export interface VerifiedResult extends ResultBase {
  result: 'verified';
  dat_odmit?: string;
  warnings: Warning[];
}

export type SendResult = AcceptedResult | RejectedResult | RetryResult | VerifiedResult;
