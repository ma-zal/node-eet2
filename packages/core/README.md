# eet2-core

Knihovna pro **EET 2.0** (elektronická evidence tržeb v ČR): sestavení, podpis a odeslání datové zprávy o tržbě, klasifikace výsledku a načtení pokladního certifikátu.

> **Stav: ve vývoji (0.x).** Automatická obnova certifikátu přes CA EET zatím chybí.

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
