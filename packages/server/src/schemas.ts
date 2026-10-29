import { Type, type Static } from '@sinclair/typebox';

/** Tělo `POST /api/v1/sales` (ADR-005). Názvy převzaté doslova z rozhraní EET. */
export const SaleRequestSchema = Type.Object(
  {
    prvni_zaslani: Type.Boolean(),
    overeni: Type.Optional(Type.Boolean()),
    data: Type.Object(
      {
        eic_popl: Type.Optional(Type.String()),
        eic_poverujiciho: Type.Optional(Type.String()),
        povereni_vice_popl: Type.Optional(Type.Boolean()),
        id_jednotky: Type.Integer(),
        id_pokl: Type.String(),
        porad_cis: Type.String(),
        dat_trzby: Type.String(),
        celk_trzba: Type.String(),
        urceno_cerp_zuct: Type.Optional(Type.String()),
        cerp_zuct: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type SaleRequest = Static<typeof SaleRequestSchema>;

/** Tělo `PUT /api/v1/certificate` – názvy shodné s `Pkcs12DTO` z CA EET API. */
export const CertificateUploadSchema = Type.Object(
  {
    pkcs12: Type.String({ minLength: 1, description: 'Obsah souboru .p12 v base64' }),
    password: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type CertificateUpload = Static<typeof CertificateUploadSchema>;

/** Druhy chyb v odpovědích mimo `POST /api/v1/sales`. */
export type ApiErrorType =
  | 'validation'
  | 'no_certificate'
  | 'invalid_certificate'
  | 'renewal_unavailable'
  | 'not_found'
  | 'internal';

export function apiError(type: ApiErrorType, message: string): { error: { type: ApiErrorType; message: string } } {
  return { error: { type, message } };
}
