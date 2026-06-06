# RepuFi Brain

Module two for PACT/RepuFi. It turns natural-language commitments into predicates, prices breach risk from credibility profiles, places market-making positions, verifies outcomes, signs verdicts, and can run fully against `LocalLedgerMock` before a chain is available.

## Commands

Run from the repository root:

```bash
npm run brain:test
npm run brain:typecheck
npm run brain:selfcheck
npm run brain:demo -- --path kept
npm run brain:demo -- --path breach
```

For real module-one integration:

```bash
npm run node
npm run deploy
npm run brain:smoke
```

`brain:smoke` reads contract addresses and ABIs from `ledger/shared/`, creates an on-chain pact, places a Brain skeptic position, submits an EIP-191 signed verdict, and reads `CredibilitySBT.getProfile`.

## Boundaries

- `brain/agents/base/ledger.ts` is the only Ledger boundary.
- `MODE=mock` uses `brain/mocks/LocalLedgerMock.ts`.
- `MODE=local` or `MODE=testnet` uses `brain/agents/base/repuFiLedger.ts`.
- `ledger/shared/schemas.ts`, `ledger/shared/addresses.json`, and `ledger/shared/abis/` remain the single integration source of truth.
