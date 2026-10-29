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
export {
  CertificateManager,
  MemoryCertificateStore,
  type CertificateManagerLog,
  type CertificateManagerOptions,
  type CertificateState,
  type CertificateStatus,
  type CertificateStore,
  type RenewalError,
  type RenewalStateName,
  type StoredCertificate,
  type StoredRenewal,
} from './certificate/manager.js';

export {
  CA_EET_API_URLS,
  CaEetApiError,
  CaEetClient,
  type CaCertificate,
  type CaEetApi,
  type CaEetApiErrorKind,
  type CaEetClientOptions,
  type CaPkcs12,
  type CaRequestStatus,
} from './ca/ca-client.js';
