# Architektonická rozhodnutí

Záznam klíčových rozhodnutí pro `eet2-core` a `eet2-server`. Konvence projektu jsou v [AGENTS.md](../AGENTS.md).

Fakta z oficiální dokumentace, ze kterých rozhodnutí vychází (zdroje viz AGENTS.md):

- První pokus o odeslání musí proběhnout nejpozději v okamžiku tržby. Dávkové odesílání se nepřipouští. Mezní doba odezvy je nejméně 2 s.
- Při překročení mezní doby odezvy se tržba odešle bezodkladně po obnovení spojení, nejpozději do 48 h. Povinnost trvá i po 48 h.
- Opakované zaslání: oblast `<Data>` beze změny, nové `uuid_zpravy`, nové `dat_odesl`, `prvni_zaslani=false`. Systém EET rozpozná opakované zaslání podle obsahu tržby, opakování je proto bezpečné.
- Zprávu podepisuje vždy aktuálně platný certifikát, i když je tržba starší.
- Účtenku ani potvrzovací kód (POK) není povinné tisknout.
- Pokladní certifikát: první se vydává ručně v DIS+ jako `.p12` s osmiznakovým heslem. Klíčový pár generuje CA, ne klient. Platnost 366 dní. `.p12` je v legacy formátu (3DES), který OpenSSL 3 bez legacy provideru nenačte.
- Obnova certifikátu přes CA EET API: JWT podepsaný obnovovaným, ještě platným certifikátem. Asynchronní průběh `renew → status → claim-download → ack-download`. Doporučeno 2–3 týdny před vypršením.

---

## ADR-001: eet2 je podepisovací brána bez fronty tržeb

### Kontext

Pokladní systém potřebuje tržbu odeslat, opakovat při výpadku a hlídat lhůtu 48 h. Současně musí někdo držet pokladní certifikát a obnovovat ho.

### Rozhodnutí

- **eet2** zná protokol EET a pokladní certifikát. Tržbu sestaví, podepíše, odešle a vrátí klasifikovaný výsledek. Spravuje certifikát včetně automatické obnovy.
- **eet2 nedrží frontu tržeb** a nic neopakuje. Je bezstavový vůči tržbám.
- **Pokladní systém** rozhoduje, co a kdy odeslat. Drží frontu, opakuje, hlídá lhůtu 48 h a zobrazuje stav.

### Zdůvodnění

Tržba musí vzniknout atomicky s účtenkou. Kdyby frontu držel eet2, vznikl by dvojí zápis: účtenka by se uložila v databázi pokladního systému, ale eet2 by v tu chvíli nemusel běžet a tržba by se ztratila. Pokladní systém by tedy vlastní frontu potřeboval tak jako tak. Daňově důležitá data navíc patří tam, kde jsou účtenky a jejich zálohy.

### Důsledky

- Volající sám určuje `prvni_zaslani` (ví, kolik pokusů už proběhlo).
- eet2 generuje pro každé volání nové `uuid_zpravy` a `dat_odesl` a vrací je ve výsledku k zalogování.
- Ztráta úložiště eet2 neznamená ztrátu tržeb, jen nutnost znovu nahrát certifikát.

## ADR-002: Struktura repozitáře – npm workspaces s core a serverem

### Rozhodnutí

Jeden repozitář s npm workspaces:

```
node-eet2/
├── package.json              # private root, workspaces, skripty build/test/typecheck
├── tsconfig.base.json        # ESM, NodeNext, strict
├── Dockerfile                # image serveru; build context = root (potřebuje core i server)
├── packages/
│   ├── core/                 # npm balíček eet2-core, ESM + typy
│   │   ├── src/
│   │   │   ├── sale/         # model <Trzba>, validace a formátování dle XSD
│   │   │   ├── soap/         # obálka, WS-Security podpis, parsování a ověření odpovědi
│   │   │   ├── client/       # EetClient – odeslání + klasifikace výsledku
│   │   │   ├── certificate/  # načtení .p12, CertificateStore, CertificateManager
│   │   │   ├── ca/           # CaEetClient – CA EET API
│   │   │   └── index.ts      # veřejné API
│   │   ├── schema/           # EETXMLSchema.xsd, EETServiceSOAP.wsdl, caeetapi_jwt.yml
│   │   ├── certs/
│   │   │   ├── ca-eet/       # CA EET (playground, produkce) – kontrola vydavatele pokladního certifikátu
│   │   │   └── ica/          # I.CA – ověření podpisu potvrzovacích zpráv
│   │   └── test/
│   │       ├── unit/         # offline testy (npm test)
│   │       ├── playground/   # integrační testy proti playground (npm run test:playground)
│   │       └── fixtures/     # skutečné odpovědi playground, veřejný testovací certifikát
│   └── server/               # eet2-server, private, publikuje se jen jako Docker image
│       ├── src/              # app.ts, server.ts, routes/, services/, schemas/
│       └── test/
├── docs/architecture-decisions.md
├── scripts/                  # download-playground-fixtures.mjs
├── .changeset/
├── .github/workflows/        # ci.yml, release.yml
├── AGENTS.md
├── LICENSE                   # MIT
└── README.md
```

- Server závisí na core přes workspace. V jednom commitu jsou tak vždy kompatibilní a Docker build nepotřebuje publikovaný core.
- Core je ESM-only.
- Technické přílohy pro vývojáře (XSD, WSDL, `caeetapi_jwt.yml`) a veřejné certifikáty CA EET jsou součástí core.
- PDF dokumenty z eet.gov.cz v repozitáři nejsou. Část je označená TLP:AMBER, odkazujeme na oficiální zdroj.

## ADR-003: Verzování a release přes Changesets

### Kontext

Core je knihovna na npm, server je Docker image, který core obsahuje. Změna v core musí vždy vyrobit nové image. Změna jen v serveru nesmí vydat nový, ale identický core.

### Rozhodnutí

- Oba balíčky mají vlastní semver: `eet2-core` (veřejný, npm) a `eet2-server` (`private: true`, jen Docker image).
- Tagy ve formátu Changesets: `eet2-core@X.Y.Z`, `eet2-server@X.Y.Z`.
- `.changeset/config.json`:
  - `privatePackages: { version: true, tag: true }`: server se verzuje a taguje, i když se nepublikuje na npm.
  - `updateInternalDependencies: "patch"`: každý bump core aktualizuje závislost serveru a server tím dostane automaticky patch bump.
- Výsledek:
  - změna jen v serveru = release jen serveru,
  - změna v core = release core a automaticky i serveru.
- Průběh:
  1. Ke každé změně s dopadem na uživatele se přidá changeset (`npx changeset`).
  2. `changesets/action` na `master` otevře nebo aktualizuje PR „Version Packages“ (verze, `CHANGELOG.md` pro každý balíček).
  3. Merge tohoto PR spustí `changeset publish`: publikuje `eet2-core` na npm a vytvoří tagy.
  4. Docker build běží ve stejném `release.yml` podle výstupu `publishedPackages` (pokud obsahuje `eet2-server`). Tagy vytvořené přes `GITHUB_TOKEN` by samostatný workflow na tag nespustily.
- Image `ghcr.io/ma-zal/eet2-server` (explicitně, ne výchozí název podle repozitáře). Tagy `X.Y.Z`, `X.Y`, `X`, `latest`. Navíc `edge` z každého pushe do `master` pro testy před releasem. Multi-arch `linux/amd64` + `linux/arm64` (Raspberry Pi).
- npm publish s provenance: npm trusted publishing přes OIDC, případně secret `NPM_TOKEN`.
- `ci.yml` na každý PR i push: `npm ci`, typecheck, testy všech workspaces.

### Důsledky

- Nekompatibilní změna HTTP API znamená major verzi serveru a novou cestu `/api/v2`. `/api/v1` po přechodnou dobu zůstává. Uživatelé pinují major (`eet2-server:1`).
- Dohledatelnost: OCI labely image (`org.opencontainers.image.version`, `org.opencontainers.image.revision`) a `GET /api/v1/status` vrací `server_version`, `core_version`, `git_sha`.

## ADR-004: Jazyk a pojmenování

### Rozhodnutí

- **Jazyk dokumentace a komentářů odpovídá jazyku oficiální dokumentace EET, tedy češtině.** Platí pro README, AGENTS.md, ADR i komentáře v kódu. Finanční správa vydává dokumentaci primárně česky; popis položek, postupy CA EET, `caeetapi_jwt.yml`, příručka i zákon existují jen česky, anglické překlady má jen část technických dokumentů.
- Chybové a jiné zprávy pro uživatele jsou česky.
- Identifikátory v kódu jsou anglicky, **kromě oficiálních názvů z rozhraní EET (XSD/WSDL) a CA EET API**. Ty se přebírají doslova.
- HTTP JSON i datové typy core jsou jednotně v `snake_case` (oficiální názvy jsou `snake_case`). Server tak výsledky z core jen serializuje.
- Třídy, funkce a options v TypeScriptu podle konvencí TS (`EetClient.sendSale()`, `SaleData`, `SendResult`, `CaEetClient`, `CertificateManager`, `CertificateStore`).
- `config.cjs` serveru v `camelCase`.
- Oficiální anglický název EET je „Electronic Registration of Sales“, proto `sale` / `sales` pro tržbu.

| Oblast | Oficiální názvy (beze změny) | Naše názvy (anglicky) |
|---|---|---|
| Request `POST /api/v1/sales` | `prvni_zaslani`, `overeni`; v `data` vše z `<Data>`: `eic_popl`, `eic_poverujiciho`, `povereni_vice_popl`, `id_jednotky`, `id_pokl`, `porad_cis`, `dat_trzby`, `celk_trzba`, `urceno_cerp_zuct`, `cerp_zuct` | cesta `sales`, obal `data` |
| Response | `uuid_zpravy`, `dat_odesl`, `dat_prij`, `dat_odmit`, `pok`, `test`, `kod` (z `<Chyba>`), `kod_varov` (z `<Varovani>`) | `result`, `warnings[{ kod_varov, message }]`, `error{ type, kod, message }`, `signature_valid`, `global_transaction_id` (z hlavičky `X-Global-Transaction-Id`), `duration_ms` |
| `GET /api/v1/status` | `eic`; stav žádosti CA doslova (`INPROCESS`, `ISSUED`, `DELIVERING`, `FINISHED`, `REJECTED`) v `ca_state`; `req_id` (= `reqId` z CA API, jen `snake_case`) | `environment`, `certificate{ … }`, `renewal{ … }`, `last_success_at`, `last_error`, verze |
| `PUT /api/v1/certificate` | `pkcs12`, `password` (shodné s CA API `Pkcs12DTO`) | – |
| Core – typy CA EET API | názvy z `caeetapi_jwt.yml` doslova včetně `camelCase`: `reqId`, `state`, `pollAfterSeconds`, `rejectedReason`, `sn`, `validFrom`, `validTo` | `CaEetClient`, `CaEetApi`, `CaRequestStatus`, `CaPkcs12` |

## ADR-005: HTTP API eet2-server v1

### Endpointy

| Endpoint | Účel |
|---|---|
| `POST /api/v1/sales` | podepíše a odešle jednu tržbu, výsledek vrátí synchronně |
| `GET /api/v1/status` | certifikát, stav obnovy, poslední úspěch a chyba, verze |
| `PUT /api/v1/certificate` | nahrání `.p12` a hesla (ADR-007) |
| `POST /api/v1/certificate/renew` | ruční spuštění obnovy (ADR-008) |
| `GET /healthy` | Docker healthcheck |

### `POST /api/v1/sales`

```jsonc
{
  "prvni_zaslani": true,         // povinné; určuje volající podle počtu pokusů
  "overeni": false,              // volitelné; true = ověřovací mód (test spojení, nic se neeviduje)
  "data": {                      // 1:1 s XSD <Data>
    "eic_popl": "CZ00000019",    // volitelné; výchozí = EIČ z certifikátu
    "eic_poverujiciho": "…",     // volitelné
    "povereni_vice_popl": true,  // volitelné
    "id_jednotky": 181,
    "id_pokl": "POKLADNA1",
    "porad_cis": "162600123",
    "dat_trzby": "2027-01-07T21:01:00Z", // libovolný ISO 8601 okamžik
    "celk_trzba": "350.00",      // string, přesně 2 desetinná místa
    "urceno_cerp_zuct": "…",     // volitelné
    "cerp_zuct": "…"             // volitelné
  }
}
```

- eet2 převede `dat_trzby` a `dat_odesl` na lokální čas Europe/Prague s offsetem (`+01:00` / `+02:00`) bez milisekund.
- Částky jsou stringy, aby nevznikaly chyby zaokrouhlení. eet2 validuje formát podle XSD (žádné vedoucí nuly, zakázané `-0.00`, absolutní hodnota pod 100 mil.).
- Zpráva se před odesláním kontroluje na limit 12 kB včetně SOAP obálky.
- HTTP: `POST` na endpoint prostředí, HTTP/1.1, TLS ≥ 1.2 s ověřením certifikátu serveru, `Content-Type: text/xml; charset=utf-8`, `SOAPAction: "http://fs.gov.cz/eet/OdeslaniTrzby"`.

### Odpověď

Pokud eet2 požadavek zpracuje, vrací vždy HTTP 200 s polem `result`:

```jsonc
// accepted – tržba přijata, máme POK
{ "result": "accepted", "uuid_zpravy": "…", "dat_odesl": "…", "prvni_zaslani": true,
  "dat_prij": "…", "pok": "…-03", "test": false, "signature_valid": true,
  "warnings": [{ "kod_varov": 4, "message": "Datum a cas uskutecneni trzby je novejsi…" }],
  "global_transaction_id": "…", "duration_ms": 412 }

// rejected – trvalá chyba, opakování se stejnými daty nepomůže
{ "result": "rejected", "uuid_zpravy": "…", "dat_odesl": "…", "prvni_zaslani": true,
  "dat_odmit": "…", "test": false,
  "error": { "type": "eet", "kod": 3, "message": "XML zprava nevyhovela kontrole XML schematu" },
  "global_transaction_id": "…", "duration_ms": 380 }

// retry – dočasná chyba, poslat znovu později s prvni_zaslani=false
{ "result": "retry", "uuid_zpravy": "…", "dat_odesl": "…", "prvni_zaslani": true,
  "error": { "type": "timeout", "message": "EET neodpověděl do 5000 ms." },
  "duration_ms": 5003 }

// verified – ověřovací mód, kód 0
{ "result": "verified", "uuid_zpravy": "…", "dat_odesl": "…", "test": false,
  "warnings": [], "duration_ms": 350 }
```

- Pole bez hodnoty se ve výsledku vynechávají (např. `error.kod` mimo `type: eet`, `signature_error` při platném podpisu).
- Při neplatných vstupních datech se nic neodesílá: `result: rejected`, `error.type: validation`, bez `uuid_zpravy`.
- `503` s tělem `{ "error": { "type": "no_certificate", "message": "…" } }`: eet2 nemá platný certifikát.
- Pravidlo pro volajícího: HTTP 200 → řídit se podle `result`. Cokoli jiného (spojení odmítnuto, timeout volání, 5xx včetně 503) → stejně jako `retry`.

### `GET /api/v1/status`

```jsonc
{
  "environment": "playground",          // playground | production
  "server_version": "1.0.0", "core_version": "1.0.0", "git_sha": "…",
  "certificate": {                      // chybí, pokud není nahrán
    "eic": "CZ00000019", "serial_number": "…",
    "valid_from": "…", "valid_to": "…", "days_left": 214,
    "installed_at": "…", "source": "upload"      // upload | renewal
  },
  "renewal": {
    "state": "scheduled",               // idle | scheduled | in_progress | failed | expired (ADR-008)
    "automatic": true,                  // je nakonfigurované CA EET API
    "scheduled_at": "…", "next_attempt_at": "…",
    "req_id": "…", "ca_state": "INPROCESS",
    "last_error": { "at": "…", "message": "…" }
  },
  "last_success_at": "…",
  "last_error": { "at": "…", "message": "…" }
}
```

## ADR-006: Klasifikace výsledku odeslání

### Rozhodnutí

| Situace | `result` | `error.type` |
|---|---|---|
| Potvrzení s POK | `accepted` | – |
| Ověřovací mód, kód 0 | `verified` | – |
| Chyba, kód -1 (dočasná technická chyba) | `retry` | `eet` |
| Chyba, kód 8 (technická chyba nebo chyba dat) | `retry` | `eet` |
| Chyba, kódy 2, 3, 4, 6, 7 | `rejected` | `eet` |
| Chyba, ostatní záporné kódy (rezervované -999 až -2) | `retry` | `eet` |
| Chyba, ostatní kladné kódy (rezervované 1, 5, 9 až 999) | `rejected` | `eet` |
| Žádná odpověď do timeoutu (výchozí 5 s, minimum 2 s) | `retry` | `timeout` |
| Síťová chyba, spojení přerušeno, žádná odpověď | `retry` | `network` |
| HTTP stav bez platné odpovědi EET | `retry` | `http` |
| SOAP Fault | `retry` | `soap_fault` |
| Nečitelná nebo neočekávaná odpověď | `retry` | `invalid_response` |
| Neplatná vstupní data | `rejected` | `validation` |

- Kód 8 může znamenat chybu dat. Volajícímu se doporučuje po několika pokusech přestat automaticky opakovat a požádat o zásah obsluhu.
- Kód 4 (neplatný podpis) může způsobit i vypršený nebo zneplatněný certifikát. Po nahrání nového certifikátu má volající takové tržby znovu zařadit k odeslání.
- **Podpis odpovědi:** eet2 ověřuje XML podpis potvrzovací zprávy. Výsledek je v `signature_valid`, důvod neplatnosti v `signature_error`. Neplatný podpis nemění `result`, protože transport chrání TLS s ověřením serveru. eet2 ho ale zaloguje a promítne do statusu. Ověřuje se:
  - podpisový certifikát je platný a vede přes I.CA Public CA/RSA 06/2022 k I.CA Root CA/RSA 05/2022 (Přístupové a provozní informace, kap. 3.3; certifikáty jsou v `packages/core/certs/ica/`, otisky SHA-256 ověřené proti https://www.ica.cz/korenove-certifikaty),
  - certifikát patří Generálnímu finančnímu ředitelství (`organizationIdentifier=NTRCZ-72080043`), takže odpověď nemůže podepsat jiný držitel certifikátu od I.CA,
  - XML podpis sedí a vztahuje se právě na `soapenv:Body`, ze kterého se čtou data (ochrana proti signature wrapping).
- Varování (`<Varovani>`) nikdy nemění `result`, vrací se v `warnings`.

## ADR-007: Uložení a nahrání pokladního certifikátu

### Rozhodnutí

- Certifikát je v úložišti eet2-serveru `.storage/` (Docker volume), ne v databázi pokladního systému. Privátní klíč neopouští kontejner eet2.
- **Nahrání** (`PUT /api/v1/certificate`, tělo `{ "pkcs12": "<base64>", "password": "…" }`):
  1. Načtení `.p12` včetně legacy 3DES (pure-JS parser, např. node-forge, bez závislosti na OpenSSL legacy provideru).
  2. Kontroly: právě jeden privátní klíč a jeden koncový certifikát; klíč patří k certifikátu; certifikát je právě platný; vydavatel odpovídá CA EET **nakonfigurovaného prostředí** (playground certifikát v produkci se odmítne); CN má tvar EIČ (`CZ[0-9]{8,10}`).
  3. Při chybě se nic nemění a vrátí se `400` s českou zprávou.
  4. Při úspěchu se nový certifikát stane aktuálním. Dosavadní se přesune do `previous` jen pro historii, k podpisu se nepoužívá.
- Heslo k `.p12` se neukládá. Po načtení se klíč a certifikát uloží v PEM.
- Správu certifikátu včetně obnovy dělá `CertificateManager` z core. Stav ukládá jako jeden dokument `CertificateState` přes rozhraní `CertificateStore`; server ho ukládá do souboru `.storage/certificate.json`, embedder si může dodat vlastní úložiště. Obsah:
  - `version`,
  - `current` a `previous`, každý s poli `cert_pem`, `key_pem`, `chain_pem[]`, `eic`, `serial_number`, `valid_from`, `valid_to`, `installed_at`, `source` (`upload` / `renewal`),
  - `renewal` – rozběhnutá žádost o obnovu (ADR-008),
  - `last_renewal_error`, `next_renewal_attempt_at`.
- Zápis atomicky (dočasný soubor + rename), oprávnění `0600`, souběžné zápisy chrání in-process mutex.
- Volitelné šifrování privátního klíče: pokud je nastavená proměnná prostředí `EET2_KEY_PASSPHRASE`, ukládá se klíč jako šifrovaný PKCS#8. Bez ní se uloží nešifrovaně a status na to upozorní. CA EET doporučuje klíč nešifrovaný neuchovávat.
- Klíč, heslo ani obsah `.p12` se nikdy nevrací přes API ani nelogují.

### Konfigurace `.storage/config.cjs`

```js
module.exports = {
  environment: 'playground',   // 'playground' | 'production' – určuje endpoint EET, CA API a očekávanou CA
  requestTimeoutMs: 5000,      // mezní doba odezvy, minimum 2000
  renewBeforeDays: 21,         // kdy začít obnovu před koncem platnosti
};
```

- Načítání a validace jako teya ADR-002: chybějící `.storage/` znamená fail-fast (nepřipojený volume). Chybějící `config.cjs` se založí z šablony.
- URL endpointu EET a CA API jsou odvozené z `environment` a lze je přepsat (`eetUrl`, `caApiUrl`) pro vývoj.

## ADR-008: Automatická obnova certifikátu

### Rozhodnutí

- Obnovu řídí `CertificateManager` (core). Server ho spustí s periodickou kontrolou každou hodinu; obnova začne při první kontrole po `valid_to − renewBeforeDays` (výchozí 21 dní). Pokud je termín po startu už v minulosti, začne hned.
- Autentizace k CA EET API: pro každé volání nový JWT.
  - Header: `alg: RS256`, `typ: JWT`, `x5t#S256` = base64url(SHA-256(DER certifikátu)).
  - Payload: `iat` (o 30 s do minulosti kvůli případně předbíhajícím hodinám) a `exp` = `iat` + 240 s (CA vyžaduje nejvýše 5 minut).
  - Podpis privátním klíčem obnovovaného certifikátu, implementace přes `node:crypto` bez další knihovny.
  - Všechna volání jedné žádosti (včetně `ack-download` po instalaci nového certifikátu) se autentizují obnovovaným certifikátem.
- Průběh, rozběhnutá žádost je v `CertificateState.renewal` (`req_id`, `ca_state`, `started_at`, `renewing_serial_number`):
  1. `GET /request/not-finished`: pokud existuje rozběhnutá žádost (např. po pádu), navázat na ni místo nové.
  2. `POST /request/renew`: `req_id` se uloží **před** pollingem.
  3. `GET /request/{reqId}/status` podle `pollAfterSeconds`, dokud je stav `INPROCESS`. Pokud žádost v jednom běhu nevyřídí do 10 min, zkontroluje se znovu za 15 min (nejde o chybu).
  4. Stav `ISSUED` nebo `DELIVERING`: `POST /request/{reqId}/claim-download`, validace jako při nahrání (ADR-007) a navíc stejné EIČ jako obnovovaný certifikát, uložení jako aktuální certifikát.
  5. Teprve po úspěšném uložení `POST /request/{reqId}/ack-download` a smazání `renewal`. Do potvrzení jde certifikát stáhnout znovu (nejvýše 30 dní od vydání); při opakovaném stažení téhož certifikátu se znovu neinstaluje.
  6. Stav `FINISHED`: převzetí už bylo potvrzeno. Pokud nový certifikát nemáme, je ztracený a podá se nová žádost.
- Chyby (`last_renewal_error`, `next_renewal_attempt_at`, přežijí restart):
  - síť, timeout, 5xx → opakovat po 1 h; 429 → podle `Retry-After`,
  - `REJECTED` nebo nepoužitelný vydaný certifikát → stav `failed` s důvodem, nový pokus po 24 h,
  - 401 → certifikát CA neuznává, nový pokus po 24 h; pokud mezitím vypršel, stav `expired`,
  - 404 u rozběhnuté žádosti → žádost v CA neexistuje (např. propadla lhůta 30 dní), příště se podá nová.
- Po vypršení certifikátu automatická obnova není možná (CA vyžaduje platný certifikát). Stav `expired` vyžaduje ruční vydání v DIS+ a nahrání (ADR-007).
- `POST /api/v1/certificate/renew` spustí obnovu hned, pokud žádná neběží.
- CA API URL (`CA_EET_API_URLS` v core):
  - produkce `https://ca.caeet.gov.cz/api`,
  - testovací `https://ca.test.caeet.gov.cz/api` a zkušební `https://ca.zkus.caeet.gov.cz/api`,
  - pro playground otevřená otázka. Playground certifikáty CA EET pravděpodobně neobnoví; ověřit, zda testovací CA vydává testovací certifikáty. Bez nakonfigurovaného CA API se automatická obnova neprovádí a stav obnovy je `idle` s `automatic: false`.
- Stavy obnovy (`renewal.state`):
  - `idle` – není certifikát, nebo automatická obnova není k dispozici,
  - `scheduled` – naplánovaná na `scheduled_at`,
  - `in_progress` – žádost v CA EET běží,
  - `failed` – poslední pokus selhal, další v `next_attempt_at`,
  - `expired` – certifikát vypršel.
- `/healthy` vrací chybu jen ve stavu `expired` (certifikát vypršel a obnova se nepovedla). Čerstvě nasazená služba bez certifikátu je zdravá (vzor teya ADR-004).

## ADR-009: Síťový model – bez autentizace, jen interní síť

### Rozhodnutí

- eet2-server nemá vlastní autentizaci. Běží v Dockeru bez publikovaného portu a volá ho jen pokladní systém ve stejné interní síti (vzor teya ADR-006).
- Jedna instance = jeden pokladní certifikát (jedno EIČ). Více poplatníků = více instancí s vlastním `.storage`.
- Nahrání certifikátu z UI pokladního systému jde přes jeho autentizovaný backend, který volá JSON API eet2. Proxovaná HTML stránka by nefungovala (podepisující proxy pokladního systému neumožní POST z formuláře; stejný problém jako teya ADR-009).

### Důsledky

- Služba umí podepsat libovolnou tržbu certifikátem poplatníka. Před zpřístupněním mimo interní síť je nutné nejdřív doplnit autentizaci.
- Mutexy a plánovač obnovy chrání jen v rámci jednoho procesu. Víc instancí nad stejným `.storage` se nepodporuje.

## ADR-010: Technologie

- Node.js ≥ 22, TypeScript, ESM, `NodeNext`.
- Server: Fastify + TypeBox (schémata = validace + typy), stejně jako teya ADR-008.
- XML podpis a parsování: `xml-crypto` + `@xmldom/xmldom` (ověřeno v PoC).
- `.p12`: node-forge (pure JS, podporuje legacy 3DES; ověřeno na oficiálních testovacích certifikátech z playground).
- HTTP klient: vestavěný `fetch` s `AbortSignal.timeout()`.
- Testy: Vitest.

## ADR-011: Testovací strategie

- **Unit testy (offline, v CI, `test/unit/`):** formátování a validace dat, sestavení a podpis obálky, parsování odpovědí a klasifikace, ověření podpisu odpovědi, načtení `.p12`, JWT pro CA, logika plánovače obnovy. Odpovědi EET jsou skutečné zachycené odpovědi playground (`test/fixtures/responses/`); testy, které závisí na době platnosti certifikátů, používají pevné „teď“. Vlastní testovací klíč a certifikát se generují v testech (nejde o certifikáty FS).
- **Integrační testy proti playground (opt-in, `npm run test:playground` z kořene, `test/playground/`):** používají oficiální sdílené testovací certifikáty. Skript `scripts/download-playground-fixtures.mjs` je stahuje z eet.gov.cz do `.fixtures/playground/` (gitignored), protože FS je po 366 dnech obmění. Playground má servisní okno zpravidla každý čtvrtek 20:00–6:00.
- **CA EET API:** do vyjasnění testovacího prostředí (ADR-008) se testuje proti mock serveru podle `caeetapi_jwt.yml`.

## ADR-012: Logování a citlivá data

- Logovat jen explicitně pojmenovaná pole (vzor teya ADR-007), např. `uuid_zpravy`, `porad_cis`, `result`, `kod`, `global_transaction_id`, `duration_ms`.
- Nikdy nelogovat: privátní klíč, heslo k `.p12`, obsah `.p12`, odpověď `claim-download`, celé JWT.
- Prostý výstup na stdout, bez knihovny pro strukturované logování.
