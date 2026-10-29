export { EET_ENDPOINTS, type EetEnvironment } from './environment.js';
export { EetCertificateError } from './errors.js';

export { EetClient, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, type EetClientOptions, type SendSaleInput } from './client/eet-client.js';
export type {
  AcceptedResult,
  RejectedResult,
  RetryResult,
  SendError,
  SendErrorType,
  SendResult,
  VerifiedResult,
  Warning,
} from './client/result.js';

export { normalizeSaleData, type NormalizedSaleData, type NormalizeSaleDataResult, type SaleData } from './sale/sale-data.js';
export { formatEetDateTime } from './sale/datetime.js';

export { credentialsFromPem, type EetCredentials } from './certificate/credentials.js';
export { loadPkcs12 } from './certificate/pkcs12.js';
export { detectCertificateEnvironment } from './certificate/trust.js';
