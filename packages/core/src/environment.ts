/** Prostředí EET: neprodukční (playground) nebo produkční. */
export type EetEnvironment = 'playground' | 'production';

/**
 * Adresy webové služby pro příjem datových zpráv.
 * Zdroj: Přístupové a provozní informace pro playground a produkci, kap. 2.1.
 */
export const EET_ENDPOINTS: Readonly<Record<EetEnvironment, string>> = {
  playground: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
  production: 'https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
};
