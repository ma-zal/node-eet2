# node-eet2

Open-source klient pro **EET 2.0** (elektronická evidence tržeb v ČR, ostrý provoz od 1. 1. 2027) pro Node.js.

> **Stav: ve vývoji.** Balíčky zatím nejsou vydané. Architektura a rozhraní jsou popsané v [docs/architecture-decisions.md](docs/architecture-decisions.md).

## Co repozitář obsahuje

| Balíček | Popis | Distribuce |
|---|---|---|
| `eet2-core` | Knihovna: sestavení, podpis a odeslání datové zprávy o tržbě, klasifikace výsledku, načtení pokladního certifikátu (`.p12`), klient CA EET pro automatickou obnovu certifikátu. | npm |
| `eet2-signing-service` | HTTP služba nad `eet2-core`. Drží pokladní certifikát, sama ho před vypršením obnovuje a nabízí jednoduché JSON API pro odeslání tržby. | Docker image `ghcr.io/ma-zal/eet2-signing-service` |

eet2 tržbu podepíše, odešle a vrátí výsledek. **Frontu tržeb, opakování odeslání a hlídání 48hodinové lhůty řeší pokladní systém**, protože tržba musí vzniknout atomicky spolu s účtenkou (viz ADR-001).

## eet2-signing-service

### Nasazení

```yaml
services:
  eet2-signing-service:
    image: ghcr.io/ma-zal/eet2-signing-service:1   # zatím nevydáno – lokálně: docker build -t eet2-signing-service:local .
    restart: unless-stopped
    volumes:
      - ./storage-eet2:/app/.storage   # konfigurace, certifikát s privátním klíčem, stav obnovy
    # environment:
    #   EET2_KEY_PASSPHRASE: "…"       # doporučeno: šifrování privátního klíče v úložišti
    # bez publikovaného portu – volá ho jen pokladní systém ve stejné síti (ADR-009)
```

1. Adresář `./storage-eet2` musí existovat. Při prvním startu se v něm založí `config.cjs` s výchozími hodnotami.
2. Nahrajte pokladní certifikát: `PUT /api/v1/certificate` s `{ "pkcs12": "<.p12 v base64>", "password": "…", "environment": "production" }`. Prostředí EET (playground / produkce) určuje certifikát podle CA EET, která ho vydala. `environment` je pojistka: musí certifikátu odpovídat, jinak se nahrání odmítne (ADR-007).
3. Odesílejte tržby: `POST /api/v1/sales`. Každá tržba uvádí `environment`, do kterého patří; pokud neodpovídá certifikátu, eet2 ji neodešle (HTTP 409).

### API

| Endpoint | Účel |
|---|---|
| `POST /api/v1/sales` | podepíše a odešle jednu tržbu |
| `GET /api/v1/status` | prostředí, certifikát, stav obnovy, poslední úspěch a chyba |
| `PUT /api/v1/certificate` | nahrání `.p12` a hesla |
| `POST /api/v1/certificate/renew` | ruční spuštění obnovy certifikátu |
| `GET /healthy` | healthcheck (chyba jen při prošlém certifikátu) |

```http
POST /api/v1/sales
Content-Type: application/json

{
  "environment": "production",
  "prvni_zaslani": true,
  "data": {
    "id_jednotky": 181,
    "id_pokl": "POKLADNA1",
    "porad_cis": "2027-000123",
    "dat_trzby": "2027-01-07T21:01:00Z",
    "celk_trzba": "350.00"
  }
}
```

Odpověď obsahuje `result` (`accepted` / `rejected` / `retry` / `verified`) a při úspěchu potvrzovací kód `pok`. Úplný popis je v ADR-005 a ADR-006.

### Lokální vyzkoušení proti playground

```bash
npm install
npm run test:playground     # mimo jiné stáhne oficiální testovací certifikáty do .fixtures/playground/

mkdir -p .storage
npm run build && npm start  # nebo `npm run dev` (watch režim nad zdrojáky, bez buildu)

# nahrání testovacího certifikátu
P12=$(base64 -i .fixtures/playground/CA_EET-Playground-CZ683555118.p12 | tr -d '\n')
PASS=$(tr -d '\r\n' < .fixtures/playground/password_pokladni_cert_playground.txt)
curl -X PUT localhost:3000/api/v1/certificate -H 'Content-Type: application/json' \
  -d "{\"pkcs12\":\"$P12\",\"password\":\"$PASS\",\"environment\":\"playground\"}"

# odeslání tržby
curl -X POST localhost:3000/api/v1/sales -H 'Content-Type: application/json' \
  -d "{\"environment\":\"playground\",\"prvni_zaslani\":true,\"data\":{\"id_jednotky\":21,\"id_pokl\":\"TEST1\",\"porad_cis\":\"T$(date +%s)\",\"dat_trzby\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"celk_trzba\":\"350.00\"}}"

curl localhost:3000/api/v1/status
```

V Dockeru stejně, jen s připojeným úložištěm:

```bash
docker build -t eet2-signing-service:local .
docker run --rm -p 3000:3000 -v "$PWD/.storage:/app/.storage" eet2-signing-service:local
```

Playground mívá servisní okno zpravidla ve čtvrtek 20:00–6:00. Potvrzovací kód z playground končí `-ff` a je jen testovací, tržbu nedokládá.

## Jazyk

Dokumentace i komentáře v kódu jsou česky, stejně jako oficiální dokumentace EET od Finanční správy. Identifikátory v kódu jsou anglicky; oficiální názvy z rozhraní EET (`prvni_zaslani`, `porad_cis`, `celk_trzba`, …) se přebírají doslova (ADR-004).

## Oficiální dokumentace

- [eet.gov.cz – Pro vývojáře](https://eet.gov.cz/pro-vyvojare/)
- [eet.gov.cz – Dokumenty k EET 2.0](https://eet.gov.cz/cs/o-eet/dokumenty-k-eet-2-0) (technická specifikace, popis položek, CA EET, testovací certifikáty)

Dokumenty Finanční správy nejsou součástí repozitáře, odkazujeme na jejich oficiální zdroj.

## Licence

[MIT](LICENSE)
