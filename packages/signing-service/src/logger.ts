export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Prostý výstup na stdout, jeden JSON na řádek (ADR-012).
 *
 * `fields` musí obsahovat jen explicitně pojmenované hodnoty (např. `{ porad_cis, result }`), nikdy celý
 * request, odpověď nebo stav certifikátu – to je pojistka proti zalogování klíče, hesla nebo obsahu `.p12`.
 */
export function log(level: LogLevel, event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}
