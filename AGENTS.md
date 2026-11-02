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
├── .github/              # CI (ci.yml) a vydání přes Release Please (release.yml)
└── release-please-config.json, .release-please-manifest.json
```

Podrobně viz ADR-002.

## Tech stack

- Node.js ≥ 22, TypeScript, ESM (`"type": "module"`, `NodeNext`)
- npm workspaces
- signing-service: Fastify + TypeBox, testy: Vitest
- XML podpis: `xml-crypto` + `@xmldom/xmldom` (ověřeno v PoC)
- Verzování: Release Please z Conventional Commits (ADR-003)

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
| `docker build -t eet2-signing-service:local .` | lokální Docker image služby |

Lokální vyzkoušení služby proti playground je popsané v [README.md](README.md).

## Vydání

Verze a CHANGELOG určují commity (Conventional Commits), nic se nepíše ručně. Podrobně ADR-003.

1. Každý push na `master` aktualizuje release PR, který udržuje Release Please (verze, `CHANGELOG.md`, `package-lock.json`).
2. **Merge release PR = vydání.** Vzniknou tagy `eet2-core@X.Y.Z` / `eet2-signing-service@X.Y.Z` a GitHub Releases, `release.yml` pak po testech vydá core na npm a službu jako Docker image.
3. Když publikace selže, release na GitHubu už existuje: `gh run rerun --failed`.

Typ commitu určuje verzi. Během 0.x:
- nekompatibilní změna (`feat!:` nebo patička `BREAKING CHANGE:`) = minor;
- `feat` / `fix` / `perf` = patch;
- přechod na 1.0.0 jen vědomě, patičkou `Release-As: 1.0.0`.

## Pravidla

- Commity podle Conventional Commits: typ anglicky (`feat`, `fix`, `perf`, `deps`, `revert`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`), popis česky. Typ určuje verzi a CHANGELOG balíčku, jehož soubory commit mění. `feat` / `fix` / `perf` / `deps` / `revert` se objeví v CHANGELOG, ostatní ne. Nekompatibilní změna `!` za typem nebo patička `BREAKING CHANGE:`.
- `eet2-signing-service` závisí na `eet2-core` přesnou verzí, ne rozsahem. Díky tomu vydání core vydá i službu (ADR-003).
- Publikuje jen `release.yml` po merge release PR. Nikdy ručně `npm publish` ani `docker push` (ADR-003).
- Závislosti s přesnou verzí (`.npmrc`: `save-exact=true`). Výjimka: runtime závislosti `eet2-core` s rozsahem `^`, přidávat explicitně `npm install -w eet2-core 'balíček@^X.Y.Z'` (ADR-010).
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
