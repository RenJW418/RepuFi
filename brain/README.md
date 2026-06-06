# RepuFi Brain

Module two for PACT/RepuFi. It turns natural-language commitments into predicates, prices breach risk from credibility profiles, places market-making positions, verifies outcomes, signs verdicts, and can run fully against `LocalLedgerMock` before a chain is available.

## Commands

Run from the repository root:

```bash
npm run brain:test
npm run brain:typecheck
npm run brain:intake
npm run brain:selfcheck
npm run brain:scenarios
npm run brain:demo -- --path kept
npm run brain:demo -- --path breach
```

`brain:intake` starts the backend goal-review agent at `http://127.0.0.1:8790/api/intake/review` by default. The Ledger frontend calls this endpoint before publishing a pact, so broad goals are rejected before wallet interaction and accepted goals return a predicate for the on-chain create-pact transaction. Override with `BRAIN_HOST` and `BRAIN_PORT`.

`brain:scenarios` runs the MD scenario matrix: L1 habit, L2 delivery, and L3 policy commitments, each through kept and breached paths. Every scenario compiles a predicate, creates a pact, prices from credibility, places a Brain position, signs a verdict, settles, and asserts the credibility delta.

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
