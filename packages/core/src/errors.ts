/**
 * Chyba při práci s pokladním certifikátem (načtení `.p12`, neplatný certifikát).
 * Zpráva je česky a je určená koncovému uživateli.
 */
export class EetCertificateError extends Error {
  override name = 'EetCertificateError';
}
