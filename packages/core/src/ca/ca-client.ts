import type { EetCredentials } from '../certificate/credentials.js';
import { createCaJwt } from './jwt.js';

/** Adresy CA EET API z `caeetapi_jwt.yml`. Pro playground certifikáty není CA v provozu. */
export const CA_EET_API_URLS = {
  production: 'https://ca.caeet.gov.cz/api',
  test: 'https://ca.test.caeet.gov.cz/api',
  trial: 'https://ca.zkus.caeet.gov.cz/api',
} as const;

/** Certifikát dle `CertificateDTO` z CA EET API – názvy převzaté doslova. */
export interface CaCertificate {
  sn: string;
  validFrom: string;
  validTo: string;
  state: 'VALID' | 'EXPIRED' | 'REVOKED' | 'ON_CRL';
  revocationTime?: string;
  description?: string;
  email?: string;
}

/** Stav žádosti o certifikát dle `RequestStatusDTO` – názvy převzaté doslova. */
export type CaRequestStatus =
  | { reqId: string; state: 'INPROCESS'; pollAfterSeconds: number }
  | { reqId: string; state: 'ISSUED' }
  | { reqId: string; state: 'DELIVERING' }
  | { reqId: string; state: 'FINISHED' }
  | { reqId: string; state: 'REJECTED'; rejectedReason: string };

/** Stažený certifikát dle `Pkcs12DTO`. Citlivá data – nelogovat ani necachovat. */
export interface CaPkcs12 {
  pkcs12: Buffer;
  password: string;
  certificate: CaCertificate;
}

/** Operace CA EET API potřebné pro automatickou obnovu certifikátu. */
export interface CaEetApi {
  /** `POST /request/renew` – podá žádost o následný certifikát. */
  renew(credentials: EetCredentials): Promise<{ reqId: string }>;
  /** `GET /request/{reqId}/status` */
  getStatus(credentials: EetCredentials, reqId: string): Promise<CaRequestStatus>;
  /** `POST /request/{reqId}/claim-download` – vrátí PKCS#12 a heslo. */
  claimDownload(credentials: EetCredentials, reqId: string): Promise<CaPkcs12>;
  /** `POST /request/{reqId}/ack-download` – potvrdí převzetí, CA pak data smaže. */
  ackDownload(credentials: EetCredentials, reqId: string): Promise<void>;
  /** `GET /request/not-finished` – neukončené žádosti pro EIČ certifikátu. */
  getNotFinished(credentials: EetCredentials): Promise<string[]>;
}

export type CaEetApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid_response';

/** Chyba volání CA EET API. Zpráva je česky. */
export class CaEetApiError extends Error {
  override name = 'CaEetApiError';

  constructor(
    message: string,
    readonly kind: CaEetApiErrorKind,
    /** HTTP stav (jen `kind: 'http'`). */
    readonly status?: number,
    /** Kód z `ErrorDTO`. */
    readonly code?: number,
    /** Doporučená prodleva z hlavičky `Retry-After` (např. u 429). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface CaEetClientOptions {
  /** Základní URL API, např. {@link CA_EET_API_URLS}.production. */
  baseUrl: string;
  /** Timeout jednoho volání v ms. Výchozí 30 000. */
  timeoutMs?: number;
  /** Implementace `fetch`, např. pro testy. */
  fetch?: typeof globalThis.fetch;
  /** Zdroj aktuálního času pro JWT, např. pro testy. */
  now?: () => Date;
}

const REQUEST_STATES = new Set(['INPROCESS', 'ISSUED', 'DELIVERING', 'FINISHED', 'REJECTED']);

/**
 * Klient CA EET API pro automatizovanou obnovu pokladního certifikátu (`caeetapi_jwt.yml`).
 * Každé volání se autentizuje novým JWT podepsaným předaným certifikátem, který musí být platný.
 */
export class CaEetClient implements CaEetApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(options: CaEetClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async renew(credentials: EetCredentials): Promise<{ reqId: string }> {
    const body = await this.request('POST', '/request/renew', credentials, 201);
    return { reqId: requireString(body, 'reqId') };
  }

  async getStatus(credentials: EetCredentials, reqId: string): Promise<CaRequestStatus> {
    const body = await this.request('GET', `/request/${encodeURIComponent(reqId)}/status`, credentials, 200);
    const state = requireString(body, 'state');
    if (!REQUEST_STATES.has(state)) {
      throw new CaEetApiError(`CA EET vrátila neznámý stav žádosti "${state}".`, 'invalid_response');
    }
    const status = { reqId: requireString(body, 'reqId'), state } as CaRequestStatus;
    if (status.state === 'INPROCESS') {
      status.pollAfterSeconds = optionalPositiveNumber(body, 'pollAfterSeconds') ?? 2;
    }
    if (status.state === 'REJECTED') {
      status.rejectedReason = optionalString(body, 'rejectedReason') ?? 'bez uvedení důvodu';
    }
    return status;
  }

  async claimDownload(credentials: EetCredentials, reqId: string): Promise<CaPkcs12> {
    const body = await this.request('POST', `/request/${encodeURIComponent(reqId)}/claim-download`, credentials, 200);
    const certificate = (body as { certificate?: unknown }).certificate;
    if (typeof certificate !== 'object' || certificate === null) {
      throw new CaEetApiError('Odpověď CA EET neobsahuje metadata certifikátu.', 'invalid_response');
    }
    return {
      pkcs12: Buffer.from(requireString(body, 'pkcs12'), 'base64'),
      password: requireString(body, 'password'),
      certificate: certificate as CaCertificate,
    };
  }

  async ackDownload(credentials: EetCredentials, reqId: string): Promise<void> {
    await this.request('POST', `/request/${encodeURIComponent(reqId)}/ack-download`, credentials, 204);
  }

  async getNotFinished(credentials: EetCredentials): Promise<string[]> {
    const body = await this.request('GET', '/request/not-finished', credentials, 200);
    const data = (body as { data?: unknown }).data ?? [];
    if (!Array.isArray(data) || !data.every((item) => typeof item === 'string')) {
      throw new CaEetApiError('Odpověď CA EET obsahuje neplatný seznam žádostí.', 'invalid_response');
    }
    return data;
  }

  private async request(method: 'GET' | 'POST', path: string, credentials: EetCredentials, expectedStatus: number): Promise<unknown> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${createCaJwt(credentials, this.now())}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CaEetApiError(`CA EET neodpověděla do ${this.timeoutMs} ms.`, 'timeout');
      }
      throw new CaEetApiError(`Síťová chyba při volání CA EET: ${error instanceof Error ? error.message : String(error)}`, 'network');
    }

    if (response.status !== expectedStatus) {
      const errorBody = tryParseJson(text) as { code?: unknown; message?: unknown; additionalInfo?: unknown } | undefined;
      const detail = [errorBody?.message, errorBody?.additionalInfo].filter((part) => typeof part === 'string').join(' – ');
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      throw new CaEetApiError(
        `CA EET vrátila HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
        'http',
        response.status,
        typeof errorBody?.code === 'number' ? errorBody.code : undefined,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (expectedStatus === 204) {
      return undefined;
    }
    const body = tryParseJson(text);
    if (typeof body !== 'object' || body === null) {
      throw new CaEetApiError('Odpověď CA EET není platný JSON objekt.', 'invalid_response');
    }
    return body;
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function requireString(body: unknown, name: string): string {
  const value = (body as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value === '') {
    throw new CaEetApiError(`Odpověď CA EET neobsahuje položku ${name}.`, 'invalid_response');
  }
  return value;
}

function optionalString(body: unknown, name: string): string | undefined {
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalPositiveNumber(body: unknown, name: string): number | undefined {
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'number' && value > 0 ? value : undefined;
}
