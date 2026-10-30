import path from 'node:path';
import { CaEetClient, CertificateManager, EetClient } from 'eet2-core';
import { buildApp } from './app.js';
import { loadConfig, resolveCaApiUrl, type ServerConfig } from './config.js';
import { FileCertificateStore } from './file-certificate-store.js';
import { log } from './logger.js';
import { readVersions } from './versions.js';

// Proměnné prostředí jen pro věci svázané s procesem a kontejnerem; konfigurace EET je v .storage/config.cjs (ADR-007).
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const storageDir = path.resolve(process.env.EET2_STORAGE_DIR ?? '.storage');
const passphrase = process.env.EET2_KEY_PASSPHRASE || undefined;

let config: ServerConfig;
try {
  config = loadConfig(storageDir);
} catch (error) {
  // Chyba konfigurace je očekávaný stav (první start, překlep), stack trace by ji jen zakryl.
  log('error', 'config_invalid', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
const caApiUrl = resolveCaApiUrl(config);
const store = new FileCertificateStore(path.join(storageDir, 'certificate.json'), passphrase);

const manager = new CertificateManager({
  store,
  environment: config.environment,
  ca: caApiUrl ? new CaEetClient({ baseUrl: caApiUrl }) : undefined,
  renewBeforeDays: config.renewBeforeDays,
  log: (level, message, fields = {}) => log(level, 'certificate', { message, ...fields }),
});
await manager.load();
manager.start();

const eetClient = new EetClient({ environment: config.environment, endpointUrl: config.eetUrl, timeoutMs: config.requestTimeoutMs });
const versions = readVersions();
const app = buildApp({ environment: config.environment, manager, eetClient, keyEncrypted: store.keyEncrypted, versions });

await app.listen({ host, port });
const certificate = manager.getStatus().certificate;
log('info', 'server_started', {
  port,
  environment: config.environment,
  storage_dir: storageDir,
  ca_api_url: caApiUrl ?? 'none',
  key_encrypted: store.keyEncrypted,
  certificate_eic: certificate?.eic,
  certificate_valid_to: certificate?.valid_to,
  ...versions,
});
if (!passphrase) {
  log('warn', 'key_not_encrypted', { message: 'EET2_KEY_PASSPHRASE není nastavená, privátní klíč se ukládá nešifrovaně.' });
}

// Fastify dokončí rozpracované požadavky a zavře server. Timery obnovy certifikátu proces nedrží (unref).
async function shutdown(signal: string): Promise<void> {
  log('info', 'server_stopping', { signal });
  manager.stop();
  await app.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
