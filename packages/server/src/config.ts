import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CA_EET_API_URLS, MIN_TIMEOUT_MS } from 'eet2-core';

/** Tvar `.storage/config.cjs` (ADR-007). */
export const ConfigSchema = Type.Object(
  {
    environment: Type.Union([Type.Literal('playground'), Type.Literal('production')]),
    requestTimeoutMs: Type.Optional(Type.Integer({ minimum: MIN_TIMEOUT_MS })),
    renewBeforeDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 180 })),
    eetUrl: Type.Optional(Type.String({ minLength: 1 })),
    caApiUrl: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export type ServerConfig = Static<typeof ConfigSchema>;

export const CONFIG_FILE_NAME = 'config.cjs';

const CONFIG_TEMPLATE = `// Konfigurace eet2-server. Po úpravě je nutný restart služby.
module.exports = {
  // Prostředí EET – povinné:
  //   'playground' – testovací prostředí pro vývojáře, POK není platný potvrzovací kód
  //   'production' – ostrý provoz
  environment: '',

  // Mezní doba odezvy EET v ms (minimum 2000).
  requestTimeoutMs: 5000,

  // Kolik dní před koncem platnosti certifikátu začít automatickou obnovu.
  renewBeforeDays: 21,

  // Přepis adresy webové služby EET (jen pro vývoj).
  // eetUrl: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',

  // Adresa CA EET API pro automatickou obnovu certifikátu.
  // Výchozí: production → https://ca.caeet.gov.cz/api, playground → žádná (CA EET pro playground není v provozu).
  // null = automatickou obnovu vypnout.
  // caApiUrl: null,
};
`;

// createRequire místo importu: config.cjs leží mimo zdrojáky a načítá se stejně z tsx i z dist (vzor teya ADR-002).
const require = createRequire(import.meta.url);

/**
 * Načte a zvaliduje `config.cjs` z adresáře úložiště.
 * - Chybějící adresář = pravděpodobně nepřipojený volume → chyba.
 * - Chybějící soubor se založí ze šablony; ta neprojde validací, dokud se nevyplní `environment`.
 */
export function loadConfig(storageDir: string): ServerConfig {
  if (!existsSync(storageDir)) {
    throw new Error(`Adresář úložiště ${storageDir} neexistuje – pravděpodobně není připojený volume.`);
  }
  const configPath = path.join(storageDir, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    writeFileSync(configPath, CONFIG_TEMPLATE, { mode: 0o600 });
    console.warn(`Založena výchozí konfigurace ${configPath} – doplňte hodnoty a službu restartujte.`);
  }

  let raw: unknown;
  try {
    raw = require(configPath);
  } catch (error) {
    throw new Error(`Konfiguraci ${configPath} se nepodařilo načíst: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Value.Check(ConfigSchema, raw)) {
    // Obecnou zprávu TypeBoxu k environment nahradí srozumitelnější.
    const problems = [...Value.Errors(ConfigSchema, raw)]
      .filter((error) => error.path !== '/environment')
      .map((error) => `${error.path || '(root)'}: ${error.message}`);
    const environment = (raw as { environment?: unknown } | undefined)?.environment;
    if (environment !== 'playground' && environment !== 'production') {
      problems.unshift(`/environment: nastavte 'playground' nebo 'production' (je "${String(environment)}")`);
    }
    throw new Error(`Neplatná konfigurace ${configPath}: ${[...new Set(problems)].join('; ')}`);
  }
  return raw;
}

/** Adresa CA EET API pro automatickou obnovu, nebo `undefined`, pokud se obnova neprovádí. */
export function resolveCaApiUrl(config: ServerConfig): string | undefined {
  if (config.caApiUrl === null) {
    return undefined;
  }
  return config.caApiUrl ?? (config.environment === 'production' ? CA_EET_API_URLS.production : undefined);
}
