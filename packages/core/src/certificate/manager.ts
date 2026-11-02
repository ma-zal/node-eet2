import { CaEetApiError, type CaEetApi } from '../ca/ca-client.js';
import type { EetEnvironment } from '../environment.js';
import { EetCertificateError } from '../errors.js';
import type { EetCredentials } from './credentials.js';
import { loadPkcs12 } from './pkcs12.js';
import { detectCertificateEnvironment } from './trust.js';

/** Uložený certifikát s informací, kdy a jak se dostal do služby. */
export interface StoredCertificate extends EetCredentials {
  installed_at: string;
  source: 'upload' | 'renewal';
}

/** Rozběhnutá žádost o obnovu v CA EET. */
export interface StoredRenewal {
  req_id: string;
  /** Poslední známý stav žádosti v CA EET (hodnota doslova z API). */
  ca_state?: string;
  started_at: string;
  /** Sériové číslo obnovovaného certifikátu – tím se žádost u CA autentizuje. */
  renewing_serial_number: string;
}

export interface RenewalError {
  at: string;
  message: string;
}

/**
 * Celý perzistentní stav certifikátu a jeho obnovy, ukládá se jako jeden dokument.
 * **Obsahuje privátní klíče** – úložiště ho musí chránit a nikdy nelogovat.
 */
export interface CertificateState {
  version: 1;
  current?: StoredCertificate;
  /** Předchozí certifikát jen pro historii a pro dokončení obnovy; k podpisu tržeb se nepoužívá. */
  previous?: StoredCertificate;
  renewal?: StoredRenewal;
  last_renewal_error?: RenewalError;
  next_renewal_attempt_at?: string;
}

/** Úložiště stavu certifikátu. signing-service ukládá do souboru, embedder si může dodat vlastní. */
export interface CertificateStore {
  load(): Promise<CertificateState | undefined>;
  save(state: CertificateState): Promise<void>;
}

/** Úložiště v paměti (testy, krátkodobé použití). */
export class MemoryCertificateStore implements CertificateStore {
  private state: CertificateState | undefined;

  async load(): Promise<CertificateState | undefined> {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }

  async save(state: CertificateState): Promise<void> {
    this.state = structuredClone(state);
  }
}

/**
 * Stav automatické obnovy:
 * - `idle` – není certifikát, nebo automatická obnova není k dispozici (bez CA EET API),
 * - `scheduled` – obnova je naplánovaná na `scheduled_at`,
 * - `in_progress` – žádost v CA EET běží,
 * - `failed` – poslední pokus selhal, další bude v `next_attempt_at`,
 * - `expired` – certifikát vypršel, automatická obnova už není možná, nutné ruční nahrání.
 */
export type RenewalStateName = 'idle' | 'scheduled' | 'in_progress' | 'failed' | 'expired';

/** Stav certifikátu bez citlivých údajů, určený k zobrazení (např. `GET /api/v1/status`). */
export interface CertificateStatus {
  /** Prostředí EET, pro které je certifikát vydán. Chybí, pokud certifikát není nahrán. */
  environment?: EetEnvironment;
  certificate?: {
    eic: string;
    serial_number: string;
    valid_from: string;
    valid_to: string;
    days_left: number;
    installed_at: string;
    source: 'upload' | 'renewal';
  };
  renewal: {
    state: RenewalStateName;
    /** Je k dispozici automatická obnova (nakonfigurované CA EET API pro prostředí certifikátu). */
    automatic: boolean;
    scheduled_at?: string;
    next_attempt_at?: string;
    req_id?: string;
    ca_state?: string;
    last_error?: RenewalError;
  };
}

export type CertificateManagerLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  fields?: Record<string, string | number | undefined>,
) => void;

export interface CertificateManagerOptions {
  store: CertificateStore;
  /** CA EET API pro jednotlivá prostředí. Pro prostředí bez něj se automatická obnova neprovádí (např. playground). */
  ca?: Partial<Record<EetEnvironment, CaEetApi>>;
  /** Kolik dní před koncem platnosti začít obnovu. Výchozí 21 (CA EET doporučuje 2–3 týdny). */
  renewBeforeDays?: number;
  /** Prodleva po chybě (síť, 5xx, ...). Výchozí 1 h. */
  retryAfterErrorMs?: number;
  /** Prodleva po zamítnutí žádosti nebo odmítnutí autentizace. Výchozí 24 h. */
  retryAfterRejectionMs?: number;
  /** Jak dlouho nejvýše čekat na vyřízení žádosti v jednom běhu. Výchozí 10 min. */
  maxPollingMs?: number;
  /** Za jak dlouho znovu zkontrolovat žádost, kterou CA v jednom běhu nevyřídila. Výchozí 15 min. */
  pendingRecheckMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Zjištění prostředí certifikátu. Výchozí podle CA EET; přepisuje se v testech. */
  detectEnvironment?: (credentials: EetCredentials) => EetEnvironment | undefined;
  log?: CertificateManagerLog;
}

const DAY_MS = 86_400_000;

/** Žádost CA zamítla nebo nový certifikát není použitelný – další pokus až po delší prodlevě. */
class RenewalRejectedError extends Error {}

/**
 * Spravuje pokladní certifikát: nahrání `.p12`, stav pro zobrazení a automatickou obnovu přes CA EET (ADR-008).
 * Prostředí EET (playground / produkce) určuje certifikát podle CA EET, která ho vydala (ADR-007).
 *
 * Postup obnovy: `not-finished` (navázání na rozběhnutou žádost) → `renew` → polling `status` →
 * `claim-download` → uložení nového certifikátu → `ack-download`. Rozběhnutá žádost je uložená ve stavu,
 * takže po restartu se pokračuje. Všechny operace se stavem běží sériově.
 */
export class CertificateManager {
  private state: CertificateState = { version: 1 };
  /** Prostředí aktuálního certifikátu. Odvozuje se z certifikátu, neukládá se. */
  private environment: EetEnvironment | undefined;
  private running = false;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;

  private readonly store: CertificateStore;
  private readonly ca: Partial<Record<EetEnvironment, CaEetApi>>;
  private readonly renewBeforeMs: number;
  private readonly retryAfterErrorMs: number;
  private readonly retryAfterRejectionMs: number;
  private readonly maxPollingMs: number;
  private readonly pendingRecheckMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly detectEnvironment: (credentials: EetCredentials) => EetEnvironment | undefined;
  private readonly log: CertificateManagerLog;

  constructor(options: CertificateManagerOptions) {
    this.store = options.store;
    this.ca = options.ca ?? {};
    this.renewBeforeMs = (options.renewBeforeDays ?? 21) * DAY_MS;
    this.retryAfterErrorMs = options.retryAfterErrorMs ?? 3_600_000;
    this.retryAfterRejectionMs = options.retryAfterRejectionMs ?? DAY_MS;
    this.maxPollingMs = options.maxPollingMs ?? 600_000;
    this.pendingRecheckMs = options.pendingRecheckMs ?? 900_000;
    this.now = options.now ?? (() => new Date());
    // Timer nesmí bránit ukončení procesu; rozběhnutá žádost je uložená a po restartu se na ni naváže.
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()));
    this.detectEnvironment = options.detectEnvironment ?? detectCertificateEnvironment;
    this.log = options.log ?? (() => undefined);
  }

  /** Načte stav z úložiště. Volá se jednou po vytvoření. */
  async load(): Promise<void> {
    await this.exclusive(async () => {
      this.state = (await this.store.load()) ?? { version: 1 };
      this.environment = this.state.current ? this.detectEnvironment(this.state.current) : undefined;
      if (this.state.current && !this.environment) {
        // Při nahrání se to kontroluje, sem se dostane jen ručně upravený stav.
        this.log('error', 'Uložený certifikát nevydala certifikační autorita EET, tržby nepůjde odeslat.', {
          serial_number: this.state.current.serial_number,
        });
      }
    });
  }

  /** Aktuální certifikát pro podpis tržeb, nebo `undefined`. */
  getCredentials(): EetCredentials | undefined {
    return this.state.current;
  }

  /** Prostředí EET aktuálního certifikátu, nebo `undefined`, pokud certifikát není nahrán. */
  getEnvironment(): EetEnvironment | undefined {
    return this.environment;
  }

  getStatus(): CertificateStatus {
    const automatic = this.currentCa() !== undefined;
    const current = this.state.current;
    if (!current) {
      return { renewal: { state: 'idle', automatic } };
    }
    const now = this.now().getTime();
    const validTo = Date.parse(current.valid_to);
    const certificate = {
      eic: current.eic,
      serial_number: current.serial_number,
      valid_from: current.valid_from,
      valid_to: current.valid_to,
      days_left: Math.floor((validTo - now) / DAY_MS),
      installed_at: current.installed_at,
      source: current.source,
    };

    let state: RenewalStateName;
    if (now >= validTo) state = 'expired';
    else if (!automatic) state = 'idle';
    else if (this.running) state = 'in_progress';
    else if (this.state.last_renewal_error) state = 'failed';
    else if (this.state.renewal) state = 'in_progress';
    else state = 'scheduled';

    const renewal: CertificateStatus['renewal'] = { state, automatic };
    if (automatic && state !== 'expired') {
      renewal.scheduled_at = new Date(this.scheduledAt(current)).toISOString();
    }
    if (this.state.next_renewal_attempt_at) renewal.next_attempt_at = this.state.next_renewal_attempt_at;
    if (this.state.renewal) {
      renewal.req_id = this.state.renewal.req_id;
      if (this.state.renewal.ca_state) renewal.ca_state = this.state.renewal.ca_state;
    }
    if (this.state.last_renewal_error) renewal.last_error = this.state.last_renewal_error;
    return { ...(this.environment ? { environment: this.environment } : {}), certificate, renewal };
  }

  /**
   * Nahraje certifikát ze souboru `.p12` (ručně vydaný v DIS+). Zkontroluje, že ho vydala CA EET
   * pro zvolené prostředí a že je právě platný. Dosavadní certifikát se přesune do `previous`.
   * Prostředí služby se tím nastaví podle certifikátu, i když bylo dosud jiné.
   *
   * @param environment prostředí, které zvolil správce. Musí odpovídat certifikátu, aby záměna
   *   certifikátu nezměnila prostředí omylem (ADR-007).
   * @throws {EetCertificateError} se srozumitelnou zprávou, pokud certifikát nelze použít.
   */
  async installPkcs12(pkcs12: Uint8Array, password: string, environment: EetEnvironment): Promise<CertificateStatus> {
    return this.exclusive(async () => {
      const credentials = this.validate(loadPkcs12(pkcs12, password), environment);
      this.replaceCurrent(credentials, environment, 'upload');
      delete this.state.renewal;
      this.clearRenewalErrors();
      await this.store.save(this.state);
      this.log('info', 'Nahrán nový pokladní certifikát.', { eic: credentials.eic, serial_number: credentials.serial_number });
      return this.getStatus();
    });
  }

  /** Spustí obnovu, pokud je na řadě (termín, rozběhnutá žádost, uplynulá prodleva po chybě). */
  async checkRenewal(): Promise<CertificateStatus> {
    await this.renew(false);
    return this.getStatus();
  }

  /** Spustí obnovu hned, bez ohledu na termín a prodlevu po chybě. U prošlého certifikátu nic neudělá. */
  async renewNow(): Promise<CertificateStatus> {
    if (!this.currentCa()) {
      throw new Error('Automatická obnova není k dispozici: CA EET API není nakonfigurované.');
    }
    await this.renew(true);
    return this.getStatus();
  }

  /** Začne pravidelně (výchozí každou hodinu) kontrolovat, zda je obnova na řadě. Timer nebrání ukončení procesu. */
  start(intervalMs = 3_600_000): void {
    this.stop();
    const check = () => {
      this.checkRenewal().catch((error: unknown) => {
        this.log('error', 'Kontrola obnovy certifikátu selhala.', { message: error instanceof Error ? error.message : String(error) });
      });
    };
    check();
    this.timer = setInterval(check, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private isRenewalDue(force: boolean): boolean {
    const current = this.state.current;
    if (!this.currentCa() || !current) {
      return false;
    }
    const now = this.now().getTime();
    if (now >= Date.parse(current.valid_to)) {
      return false;
    }
    if (force) {
      return true;
    }
    if (this.state.next_renewal_attempt_at && now < Date.parse(this.state.next_renewal_attempt_at)) {
      return false;
    }
    return this.state.renewal !== undefined || now >= this.scheduledAt(current);
  }

  private renew(force: boolean): Promise<void> {
    return this.exclusive(async () => {
      // Kontrola až uvnitř zámku – souběžné kontroly nesmí podat dvě žádosti.
      const ca = this.currentCa();
      const current = this.state.current;
      const environment = this.environment;
      if (!ca || !current || !environment || !this.isRenewalDue(force)) {
        return;
      }
      if (force) {
        this.clearRenewalErrors();
      }
      this.running = true;
      try {
        await this.runRenewal(ca, current, environment);
      } catch (error) {
        await this.handleRenewalError(error);
      } finally {
        this.running = false;
      }
    });
  }

  private async runRenewal(ca: CaEetApi, current: StoredCertificate, environment: EetEnvironment): Promise<void> {
    let renewal = this.state.renewal;
    let renewing = renewal ? this.findBySerialNumber(renewal.renewing_serial_number) : undefined;

    if (!renewal || !renewing) {
      const notFinished = await ca.getNotFinished(current);
      const reqId = notFinished[0] ?? (await ca.renew(current)).reqId;
      renewal = { req_id: reqId, started_at: this.now().toISOString(), renewing_serial_number: current.serial_number };
      renewing = current;
      this.state.renewal = renewal;
      // Žádost se uloží před pollingem, aby šlo po restartu navázat.
      await this.store.save(this.state);
      this.log('info', notFinished[0] ? 'Navazuji na rozběhnutou žádost o obnovu certifikátu.' : 'Podána žádost o obnovu certifikátu.', {
        req_id: reqId,
        serial_number: current.serial_number,
      });
    }

    const deadline = this.now().getTime() + this.maxPollingMs;
    let status = await ca.getStatus(renewing, renewal.req_id);
    while (status.state === 'INPROCESS') {
      renewal.ca_state = status.state;
      if (this.now().getTime() >= deadline) {
        // Není to chyba – žádost se jen zkontroluje znovu později.
        this.state.next_renewal_attempt_at = new Date(this.now().getTime() + this.pendingRecheckMs).toISOString();
        await this.store.save(this.state);
        return;
      }
      await this.sleep(status.pollAfterSeconds * 1000);
      status = await ca.getStatus(renewing, renewal.req_id);
    }
    renewal.ca_state = status.state;

    switch (status.state) {
      case 'ISSUED':
      case 'DELIVERING': {
        const issued = await ca.claimDownload(renewing, renewal.req_id);
        let credentials: EetCredentials;
        try {
          credentials = this.validate(loadPkcs12(issued.pkcs12, issued.password), environment, renewing.eic);
        } catch (error) {
          throw new RenewalRejectedError(`Obnovený certifikát nelze použít: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Při opakovaném stažení (např. po pádu před potvrzením) je certifikát už nainstalovaný.
        if (credentials.serial_number !== this.state.current?.serial_number) {
          this.replaceCurrent(credentials, environment, 'renewal');
          // Uložit před potvrzením převzetí – do potvrzení jde certifikát stáhnout znovu.
          await this.store.save(this.state);
          this.log('info', 'Nainstalován obnovený pokladní certifikát.', {
            req_id: renewal.req_id,
            serial_number: credentials.serial_number,
            valid_to: credentials.valid_to,
          });
        }
        await ca.ackDownload(renewing, renewal.req_id);
        delete this.state.renewal;
        this.clearRenewalErrors();
        await this.store.save(this.state);
        return;
      }
      case 'FINISHED': {
        // Převzetí už bylo potvrzeno. Pokud nový certifikát nemáme, je ztracený a podá se nová žádost.
        delete this.state.renewal;
        if (this.state.current?.serial_number !== renewal.renewing_serial_number) {
          this.clearRenewalErrors();
          await this.store.save(this.state);
          return;
        }
        throw new Error('Žádost v CA EET je ukončená, ale obnovený certifikát nebyl převzat. Podá se nová žádost.');
      }
      case 'REJECTED':
        delete this.state.renewal;
        throw new RenewalRejectedError(`CA EET žádost o obnovu zamítla: ${status.rejectedReason}`);
    }
  }

  private async handleRenewalError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    let retryMs = this.retryAfterErrorMs;
    if (error instanceof RenewalRejectedError) {
      retryMs = this.retryAfterRejectionMs;
    }
    if (error instanceof CaEetApiError) {
      if (error.status === 404) {
        // Žádost v CA neexistuje (např. vypršela lhůta 30 dní na stažení) – příště se podá nová.
        delete this.state.renewal;
      } else if (error.status === 401) {
        retryMs = this.retryAfterRejectionMs;
      } else if (error.retryAfterSeconds !== undefined) {
        retryMs = error.retryAfterSeconds * 1000;
      }
    }
    const now = this.now().getTime();
    this.state.last_renewal_error = { at: new Date(now).toISOString(), message };
    this.state.next_renewal_attempt_at = new Date(now + retryMs).toISOString();
    await this.store.save(this.state);
    this.log('error', 'Obnova certifikátu selhala.', {
      message,
      req_id: this.state.renewal?.req_id,
      next_attempt_at: this.state.next_renewal_attempt_at,
    });
  }

  /** Ověří, že certifikát vydala CA EET pro očekávané prostředí a že je právě platný. */
  private validate(credentials: EetCredentials, expectedEnvironment: EetEnvironment, expectedEic?: string): EetCredentials {
    const environment = this.detectEnvironment(credentials);
    if (environment === undefined) {
      throw new EetCertificateError('Certifikát nevydala certifikační autorita EET.');
    }
    if (environment !== expectedEnvironment) {
      throw new EetCertificateError(
        `Certifikát je vydán pro prostředí ${environment}, ne pro zvolené prostředí ${expectedEnvironment}.`,
      );
    }
    const now = this.now().getTime();
    if (now < Date.parse(credentials.valid_from) || now >= Date.parse(credentials.valid_to)) {
      throw new EetCertificateError(`Certifikát není platný (platnost ${credentials.valid_from} – ${credentials.valid_to}).`);
    }
    if (expectedEic !== undefined && credentials.eic !== expectedEic) {
      throw new EetCertificateError(`Certifikát je vydán pro EIČ ${credentials.eic}, očekáváno ${expectedEic}.`);
    }
    return credentials;
  }

  private replaceCurrent(credentials: EetCredentials, environment: EetEnvironment, source: StoredCertificate['source']): void {
    if (this.state.current && this.state.current.serial_number !== credentials.serial_number) {
      this.state.previous = this.state.current;
    }
    this.state.current = { ...credentials, installed_at: this.now().toISOString(), source };
    this.environment = environment;
  }

  /** CA EET API pro prostředí aktuálního certifikátu. */
  private currentCa(): CaEetApi | undefined {
    return this.environment ? this.ca[this.environment] : undefined;
  }

  private findBySerialNumber(serialNumber: string): StoredCertificate | undefined {
    return [this.state.current, this.state.previous].find((cert) => cert?.serial_number === serialNumber);
  }

  private clearRenewalErrors(): void {
    delete this.state.last_renewal_error;
    delete this.state.next_renewal_attempt_at;
  }

  private scheduledAt(certificate: StoredCertificate): number {
    return Date.parse(certificate.valid_to) - this.renewBeforeMs;
  }

  /** Spustí úlohu až po dokončení předchozích – operace se stavem nikdy neběží souběžně. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
