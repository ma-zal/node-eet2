import { randomUUID } from 'node:crypto';
import type { EetCredentials } from '../certificate/credentials.js';
import { EET_ENDPOINTS, type EetEnvironment } from '../environment.js';
import { formatEetDateTime } from '../sale/datetime.js';
import { normalizeSaleData, type SaleData } from '../sale/sale-data.js';
import { buildSignedMessage, MAX_MESSAGE_BYTES } from '../soap/message.js';
import { SOAP_ACTION } from '../soap/namespaces.js';
import { InvalidResponseError, parseResponse, type ParsedResponse } from '../soap/response.js';
import { verifyResponseSignature } from '../soap/verify.js';
import type { SendError, SendResult } from './result.js';

export interface EetClientOptions {
  environment: EetEnvironment;
  /** Přepis URL webové služby (např. pro vývoj). Výchozí podle prostředí. */
  endpointUrl?: string;
  /** Mezní doba odezvy v ms. Výchozí 5000, minimum 2000 (§ 19 ZoET). */
  timeoutMs?: number;
  /** Implementace `fetch`, např. pro testy. */
  fetch?: typeof globalThis.fetch;
  /** Zdroj aktuálního času, např. pro testy. */
  now?: () => Date;
}

export interface SendSaleInput {
  data: SaleData;
  /** `true` pro první pokus o zaslání tržby (i neúspěšný), `false` pro každý další. */
  prvni_zaslani: boolean;
  /** Ověřovací mód – test spojení, tržba se neeviduje. */
  overeni?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 5_000;
export const MIN_TIMEOUT_MS = 2_000;

/** Kód chyby „technická chyba nebo chyba dat“ – opakuje se, o ukončení rozhoduje volající (ADR-006). */
const AMBIGUOUS_ERROR_CODE = 8;

/**
 * Odesílá datové zprávy evidovaných tržeb. Nedrží žádný stav, frontu ani opakování –
 * to je odpovědnost volajícího (ADR-001). Každé volání má nové `uuid_zpravy` a `dat_odesl`.
 */
export class EetClient {
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(options: EetClientOptions) {
    this.endpointUrl = options.endpointUrl ?? EET_ENDPOINTS[options.environment];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (this.timeoutMs < MIN_TIMEOUT_MS) {
      throw new RangeError(`Mezní doba odezvy musí být alespoň ${MIN_TIMEOUT_MS} ms.`);
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Podepíše a odešle jednu tržbu a vrátí klasifikovaný výsledek (ADR-006). Nikdy nevyhazuje výjimku
   * kvůli odpovědi nebo síti – vše se promítne do `result`.
   */
  async sendSale(input: SendSaleInput, credentials: EetCredentials): Promise<SendResult> {
    const normalized = normalizeSaleData(input.data, credentials.eic);
    if (!normalized.ok) {
      return { result: 'rejected', error: { type: 'validation', message: normalized.errors.join(' ') }, duration_ms: 0 };
    }

    const header = {
      uuid_zpravy: randomUUID(),
      dat_odesl: formatEetDateTime(this.now()),
      prvni_zaslani: input.prvni_zaslani,
      overeni: input.overeni === true,
    };
    const message = buildSignedMessage(header, normalized.data, credentials);
    const messageBytes = Buffer.byteLength(message, 'utf8');
    if (messageBytes > MAX_MESSAGE_BYTES) {
      return {
        result: 'rejected',
        error: { type: 'validation', message: `Datová zpráva má ${messageBytes} B, limit je ${MAX_MESSAGE_BYTES} B.` },
        duration_ms: 0,
      };
    }

    const sent = { uuid_zpravy: header.uuid_zpravy, dat_odesl: header.dat_odesl, prvni_zaslani: header.prvni_zaslani };
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    let status: number;
    let body: string;
    let globalTransactionId: string | undefined;
    try {
      const response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${SOAP_ACTION}"`,
        },
        body: message,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = response.status;
      globalTransactionId = response.headers.get('x-global-transaction-id') ?? undefined;
      body = await response.text();
    } catch (error) {
      const sendError: SendError = isTimeout(error)
        ? { type: 'timeout', message: `EET neodpověděl do ${this.timeoutMs} ms.` }
        : { type: 'network', message: `Síťová chyba: ${describeError(error)}` };
      return { result: 'retry', ...sent, error: sendError, duration_ms: elapsed() };
    }
    const common = { ...sent, ...(globalTransactionId ? { global_transaction_id: globalTransactionId } : {}) };

    let parsed: ParsedResponse;
    try {
      parsed = parseResponse(body);
    } catch (error) {
      const message = error instanceof InvalidResponseError ? error.message : String(error);
      const sendError: SendError =
        status !== 200
          ? { type: 'http', message: `EET vrátil HTTP ${status} bez platné odpovědi.` }
          : { type: 'invalid_response', message };
      return { result: 'retry', ...common, error: sendError, duration_ms: elapsed() };
    }
    const durationMs = elapsed();

    switch (parsed.kind) {
      case 'fault':
        return { result: 'retry', ...common, error: { type: 'soap_fault', message: parsed.message }, duration_ms: durationMs };

      case 'potvrzeni': {
        const verification = verifyResponseSignature(body, this.now());
        return {
          result: 'accepted',
          ...common,
          ...(parsed.dat_prij ? { dat_prij: parsed.dat_prij } : {}),
          pok: parsed.pok,
          test: parsed.test,
          signature_valid: verification.valid,
          ...(verification.valid ? {} : { signature_error: verification.reason }),
          warnings: parsed.warnings,
          duration_ms: durationMs,
        };
      }

      case 'chyba': {
        const datOdmit = parsed.dat_odmit ? { dat_odmit: parsed.dat_odmit } : {};
        if (parsed.kod === 0) {
          return { result: 'verified', ...common, ...datOdmit, test: parsed.test, warnings: parsed.warnings, duration_ms: durationMs };
        }
        const error: SendError = { type: 'eet', kod: parsed.kod, message: parsed.message };
        // Kladné kódy jsou chyby zprávy (2, 3, 4, 6, 7 a rezervované), opakování nepomůže.
        // Záporné kódy (-1 a rezervované) jsou dočasné technické chyby. Kód 8 může být obojí (ADR-006).
        const permanent = parsed.kod > 0 && parsed.kod !== AMBIGUOUS_ERROR_CODE;
        return {
          result: permanent ? 'rejected' : 'retry',
          ...common,
          ...datOdmit,
          test: parsed.test,
          error,
          duration_ms: durationMs,
        };
      }
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: unknown }).code;
      return typeof code === 'string' ? `${code} (${cause.message})` : cause.message;
    }
    return error.message;
  }
  return String(error);
}
