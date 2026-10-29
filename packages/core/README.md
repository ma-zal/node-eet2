# eet2-core

Knihovna pro **EET 2.0** (elektronická evidence tržeb v ČR): sestavení, podpis a odeslání datové zprávy o tržbě, klasifikace výsledku a načtení pokladního certifikátu.

> **Stav: ve vývoji (0.x).** Automatická obnova certifikátu přes CA EET je implementovaná, ale zatím neověřená proti skutečné CA EET.

## Použití

```ts
import { readFileSync } from 'node:fs';
import { EetClient, loadPkcs12 } from 'eet2-core';

// .p12 a heslo z aplikace Správa pokladních certifikátů EET v DIS+ (legacy 3DES formát je podporovaný)
const credentials = loadPkcs12(readFileSync('pokladni-certifikat.p12'), 'ABcd1234');

const client = new EetClient({ environment: 'playground' }); // nebo 'production'

const result = await client.sendSale(
  {
    prvni_zaslani: true, // false při každém dalším pokusu o zaslání téže tržby
    data: {
      id_jednotky: 181,
      id_pokl: 'POKLADNA1',
      porad_cis: '2027-000123',
      dat_trzby: new Date(), // nebo ISO 8601 řetězec s časovou zónou
      celk_trzba: '350.00',
    },
  },
  credentials,
);

switch (result.result) {
  case 'accepted': // tržba přijata, result.pok je potvrzovací kód
  case 'verified': // jen ověřovací mód (overeni: true), nic se neeviduje
    break;
  case 'retry': // dočasná chyba – poslat znovu s prvni_zaslani: false, nejpozději do 48 h
  case 'rejected': // trvalá chyba – result.error říká proč
    break;
}
```

Názvy položek dat (`id_jednotky`, `porad_cis`, `celk_trzba`, …) jsou převzaté doslova z rozhraní EET. Částky se zadávají jako řetězec s právě dvěma desetinnými místy.

## Správa certifikátu a automatická obnova

```ts
import { CA_EET_API_URLS, CaEetClient, CertificateManager } from 'eet2-core';

const manager = new CertificateManager({
  store: myStore, // vlastní CertificateStore (load/save) – stav obsahuje privátní klíč, chraňte ho
  environment: 'production',
  ca: new CaEetClient({ baseUrl: CA_EET_API_URLS.production }),
});
await manager.load();
await manager.installPkcs12(p12, password); // první certifikát ručně z DIS+
manager.start(); // každou hodinu zkontroluje, zda je na řadě obnova (výchozí 21 dní před koncem platnosti)

const credentials = manager.getCredentials(); // aktuální certifikát pro sendSale()
const status = manager.getStatus(); // platnost a stav obnovy, bez citlivých údajů
```

Obnova probíhá přes CA EET API (`renew` → `status` → `claim-download` → `ack-download`) s JWT podepsaným obnovovaným certifikátem. Rozběhnutá žádost je uložená ve stavu, takže po restartu se pokračuje. Po vypršení certifikátu automatická obnova možná není a certifikát je nutné vydat ručně v DIS+.

## Co knihovna nedělá

Nedrží frontu tržeb a sama nic neopakuje. Tržbu musí pokladní systém uložit spolu s účtenkou a při výsledku `retry` ji poslat znovu. Každý pokus má nové `uuid_zpravy` a podepisuje se aktuálně platným certifikátem.

## Výsledek odeslání

| `result` | Význam |
|---|---|
| `accepted` | Tržba přijata. `pok`, `dat_prij`, `warnings`, `signature_valid` (ověření podpisu potvrzení). |
| `verified` | Ověřovací mód proběhl (kód 0). |
| `retry` | Dočasná chyba: timeout, síť, HTTP, SOAP Fault, kód -1 nebo 8. |
| `rejected` | Trvalá chyba: neplatná data, kódy 2, 3, 4, 6, 7. |

Podrobnosti jsou v [docs/architecture-decisions.md](https://github.com/ma-zal/node-eet2/blob/master/docs/architecture-decisions.md) (ADR-005 a ADR-006).

## Licence

MIT
