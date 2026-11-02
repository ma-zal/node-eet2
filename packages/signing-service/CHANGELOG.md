# eet2-signing-service

## 0.1.0

### Minor Changes

- První veřejné vydání: HTTP služba nad `eet2-core` (Docker image `ghcr.io/ma-zal/eet2-signing-service`). Drží pokladní certifikát, před vypršením ho obnovuje přes CA EET a nabízí JSON API pro odeslání tržby (`/api/v1`). Prostředí EET (playground / produkce) určuje nahraný certifikát.
