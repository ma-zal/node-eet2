# Changesets

Záznamy změn pro příští vydání. Postup a pravidla verzování jsou v [ADR-003](../docs/architecture-decisions.md#adr-003-verzování-a-release-přes-changesets).

- Ke každé změně s dopadem na uživatele balíčku nebo image: `npx changeset` (výběr balíčku, typ změny, popis česky).
- Změna v `eet2-core` vydá automaticky i `eet2-signing-service` (patch), protože služba core obsahuje.
- Změna jen ve službě vydá jen službu.
