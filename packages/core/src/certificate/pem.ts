/** Vrátí base64 obsah PEM bloku (bez hlaviček a zalomení), tj. DER v base64. */
export function pemToBase64(pem: string): string {
  return pem
    .replace(/-----(BEGIN|END) [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

/** Zabalí DER certifikát do PEM. */
export function derToCertificatePem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}
