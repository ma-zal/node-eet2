import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CA_EET_API_URLS, MIN_TIMEOUT_MS, type EetEnvironment } from 'eet2-core';

/** Tvar `.storage/config.cjs` (ADR-007). Prostředí EET tu není, určuje ho nahraný certifikát. */
export const ConfigSchema = Type.Object(
  {
    requestTimeoutMs: Type.Optional(Type.Integer({ minimum: MIN_TIMEOUT_MS })),
    renewBeforeDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 180 })),
    eetUrl: Type.Optional(Type.String({ minLength: 1 })),
    caApiUrl: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export type ServiceConfig = Static<typeof ConfigSchema>;

export const CONFIG_FILE_NAME = 'config.cjs';

const CONFIG_TEMPLATE = `// Konfigurace eet2-signing-service. Po úpravě je nutný restart služby.
// Prostředí EET (playground / produkce) se tu nenastavuje, určuje ho nahraný pokladní certifikát.
module.exports = {
  // Mezní doba odezvy EET v ms (minimum 2000).
  requestTimeoutMs: 5000,

  // Kolik dní před koncem platnosti certifikátu začít automatickou obnovu.
  renewBeforeDays: 21,

  // Přepis adresy webové služby EET pro obě prostředí (jen pro vývoj).
  // eetUrl: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',

  // Adresa CA EET API pro automatickou obnovu certifikátu, platí pro obě prostředí.
  // Výchozí: produkce → https://ca.caeet.gov.cz/api, playground → žádná (CA EET pro playground není v provozu).
  // null = automatickou obnovu vypnout.
  // caApiUrl: null,
};
`;

// createRequire místo importu: config.cjs leží mimo zdrojáky a načítá se stejně z tsx i z dist (vzor teya ADR-002).
const require = createRequire(import.meta.url);

/**
 * Načte a zvaliduje `config.cjs` z adresáře úložiště.
 * - Chybějící adresář = pravděpodobně nepřipojený volume → chyba.
 * - Chybějící soubor se založí ze šablony s výchozími hodnotami.
 */
export function loadConfig(storageDir: string): ServiceConfig {
  if (!existsSync(storageDir)) {
    throw new Error(`Adresář úložiště ${storageDir} neexistuje – pravděpodobně není připojený volume.`);
  }
  const configPath = path.join(storageDir, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    writeFileSync(configPath, CONFIG_TEMPLATE, { mode: 0o600 });
  }

  let raw: unknown;
  try {
    raw = require(configPath);
  } catch (error) {
    throw new Error(`Konfiguraci ${configPath} se nepodařilo načíst: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Value.Check(ConfigSchema, raw)) {
    const problems = [...Value.Errors(ConfigSchema, raw)].map((error) => `${error.path || '(root)'}: ${error.message}`);
    throw new Error(`Neplatná konfigurace ${configPath}: ${[...new Set(problems)].join('; ')}`);
  }
  return raw;
}

/** Adresa CA EET API pro automatickou obnovu v daném prostředí, nebo `undefined`, pokud se obnova neprovádí. */
export function resolveCaApiUrl(config: ServiceConfig, environment: EetEnvironment): string | undefined {
  if (config.caApiUrl === null) {
    return undefined;
  }
  return config.caApiUrl ?? (environment === 'production' ? CA_EET_API_URLS.production : undefined);
}
