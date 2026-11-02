# AGENTS

## Účel projektu

Open-source implementace EET 2.0 (elektronická evidence tržeb v ČR, ostrý provoz od 1. 1. 2027) pro Node.js. Repozitář obsahuje knihovnu `eet2-core` a HTTP službu `eet2-signing-service`. Primárním uživatelem je pokladní systém zebra-pos, řešení je ale obecné.

Architektonická rozhodnutí jsou v [docs/architecture-decisions.md](docs/architecture-decisions.md). Nové zásadní rozhodnutí = nové ADR v tomto souboru.

## Jazyk

- Komunikace s vývojářem: čeština.
- Dokumentace (MD soubory) i komentáře v kódu: čeština, stejně jako oficiální dokumentace EET od Finanční správy (ADR-004).
- Chybové a jiné zprávy pro uživatele: čeština.
- Identifikátory v kódu (proměnné, funkce, typy, soubory): angličtina.
- **Výjimka:** oficiální názvy z rozhraní EET (XSD/WSDL) a CA EET API se přebírají doslova, např. `prvni_zaslani`, `porad_cis`, `celk_trzba`, `pok`, `kod_varov`. Pravidla viz ADR-004.

## Struktura repozitáře

```
node-eet2/
├── packages/
│   ├── core/             # eet2-core, npm balíček
│   └── signing-service/  # eet2-signing-service, publikuje se jen jako Docker image
├── docs/                 # ADR
├── .changeset/           # Changesets: config.json a čekající záznamy změn
└── .github/              # CI (ci.yml) a vydání z tagu (release.yml)
```

Podrobně viz ADR-002.

## Tech stack

- Node.js ≥ 22, TypeScript, ESM (`"type": "module"`, `NodeNext`)
- npm workspaces
- signing-service: Fastify + TypeBox, testy: Vitest
- XML podpis: `xml-crypto` + `@xmldom/xmldom` (ověřeno v PoC)
- Verzování: Changesets (ADR-003)

## Skripty

Spouštět z kořene repozitáře:

| Skript | Popis |
|---|---|
| `npm install` | instalace všech workspaces |
| `npm run dev` | eet2-signing-service ve watch režimu nad zdrojáky (bez buildu); úložiště `.storage/` v kořeni repa |
| `npm start` | eet2-signing-service ze sestaveného `dist/` |
| `npm run build` | build všech workspaces |
| `npm run typecheck` | typová kontrola |
| `npm test` | unit testy (offline) |
| `npm run test:playground` | stáhne oficiální testovací certifikáty do `.fixtures/playground/` a spustí integrační testy proti playground EET (síť; čtvrtek 20:00–6:00 bývá servisní okno) |
| `npx changeset` | záznam změny pro příští vydání (interaktivní; v neinteraktivním prostředí napsat soubor do `.changeset/` ručně) |
| `npx changeset status` | co by se vydalo a v jakých verzích |
| `npm run version-packages` | verze a CHANGELOG z čekajících changesetů, srovná `package-lock.json` (viz Vydání) |
| `npx changeset git-tag` | tagy pro nové verze; jejich push spustí vydání (viz Vydání) |
| `docker build -t eet2-signing-service:local .` | lokální Docker image služby |

Lokální vyzkoušení služby proti playground je popsané v [README.md](README.md).

## Vydání

Vydání spouští tag na commitu v `master`, podrobně ADR-003.

1. Na aktuálním `master`: `npm run version-packages`, kontrola diffu (verze, `CHANGELOG.md`, `package-lock.json`), commit „Version Packages“, push, počkat na zelené CI.
2. `npx changeset git-tag` a push nových tagů (`git push origin eet2-core@X.Y.Z eet2-signing-service@X.Y.Z`).
3. `release.yml` vydá `eet2-core@…` na npm a `eet2-signing-service@…` jako Docker image, obojí s GitHub Release.

Během 0.x je nekompatibilní změna changeset `minor`, ne `major`. `major` by vydal rovnou 1.0.0.

## Pravidla

- Každá změna s dopadem na uživatele balíčku nebo image potřebuje changeset (`npx changeset`). CI to u pull requestů kontroluje.
- `eet2-signing-service` závisí na `eet2-core` přesnou verzí, ne rozsahem. Díky tomu vydání core vydá i službu (ADR-003).
- Publikuje jen `release.yml` z tagu na `master`. Nikdy ručně `npm publish` ani `docker push` (ADR-003).
- Nikdy necommitovat: privátní klíče, `.p12`, hesla, `.storage/`, `.fixtures/`.
- Nikdy necommitovat PDF dokumenty z eet.gov.cz (část je označená TLP:AMBER). V dokumentaci jen odkaz na oficiální zdroj.
- Nikdy nelogovat ani nevracet přes API: privátní klíč, heslo k `.p12`, obsah `.p12`, odpověď CA endpointu `claim-download`. Logovat jen explicitně pojmenovaná pole (ADR-012).
- Lokálně, mimo tento repozitář, existuje PoC v `../eet2/poc/` (ověřený podpis a odeslání na playground). Logika podpisu z něj se přebírá do `packages/core`.

## Oficiální zdroje

- https://eet.gov.cz/pro-vyvojare/
- https://eet.gov.cz/cs/o-eet/dokumenty-k-eet-2-0
  - Formát a struktura údajů o evidované tržbě a popis datového rozhraní (technická specifikace, aktuálně v1.2)
  - Popis položek datové zprávy s příklady jejich vyplnění
  - Přístupové a provozní informace (playground, produkce)
  - CA EET v2.0 – postupy získání pokladního certifikátu + `caeetapi_jwt.yml`
  - Sada testovacích certifikátů pro playground
