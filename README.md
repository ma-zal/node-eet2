# node-eet2

Open-source klient pro **EET 2.0** (elektronická evidence tržeb v ČR, ostrý provoz od 1. 1. 2027) pro Node.js.

> **Stav: ve vývoji.** Balíčky zatím nejsou vydané. Architektura a rozhraní jsou popsané v [docs/architecture-decisions.md](docs/architecture-decisions.md).

## Co repozitář obsahuje

| Balíček | Popis | Distribuce |
|---|---|---|
| `eet2-core` | Knihovna: sestavení, podpis a odeslání datové zprávy o tržbě, klasifikace výsledku, načtení pokladního certifikátu (`.p12`), klient CA EET pro automatickou obnovu certifikátu. | npm |
| `eet2-server` | HTTP služba nad `eet2-core`. Drží pokladní certifikát, sama ho před vypršením obnovuje a nabízí jednoduché JSON API pro odeslání tržby. | Docker image `ghcr.io/ma-zal/eet2-server` |

eet2 tržbu podepíše, odešle a vrátí výsledek. **Frontu tržeb, opakování odeslání a hlídání 48hodinové lhůty řeší pokladní systém**, protože tržba musí vzniknout atomicky spolu s účtenkou (viz ADR-001).

## Plánované použití eet2-server

```yaml
services:
  eet2-server:
    image: ghcr.io/ma-zal/eet2-server:1
    restart: unless-stopped
    volumes:
      - ./storage-eet2:/app/.storage   # certifikát, stav obnovy, konfigurace
    # bez publikovaného portu – volá ho jen pokladní systém ve stejné síti (ADR-009)
```

```http
POST /api/v1/sales
Content-Type: application/json

{
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

## Jazyk

Dokumentace i komentáře v kódu jsou česky, stejně jako oficiální dokumentace EET od Finanční správy. Identifikátory v kódu jsou anglicky; oficiální názvy z rozhraní EET (`prvni_zaslani`, `porad_cis`, `celk_trzba`, …) se přebírají doslova (ADR-004).

## Oficiální dokumentace

- [eet.gov.cz – Pro vývojáře](https://eet.gov.cz/pro-vyvojare/)
- [eet.gov.cz – Dokumenty k EET 2.0](https://eet.gov.cz/cs/o-eet/dokumenty-k-eet-2-0) (technická specifikace, popis položek, CA EET, testovací certifikáty)

Dokumenty Finanční správy nejsou součástí repozitáře, odkazujeme na jejich oficiální zdroj.

## Licence

[MIT](LICENSE)
