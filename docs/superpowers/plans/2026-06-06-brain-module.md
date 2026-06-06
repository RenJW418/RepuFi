# Brain Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module two, the PACT Brain agent layer, so it can run an end-to-end demo without module one and later swap to the real Ledger through one adapter.

**Architecture:** `shared/` owns frozen cross-module schemas. `agents/base/ledger.ts` is the only Ledger boundary and can wrap `LocalLedgerMock` now or real contracts later. Predicate, verifier, skeptic, coach, LLM, mock ledger, and scripts are separate focused units with tests covering the module-two selfcheck list.

**Tech Stack:** TypeScript, tsx, vitest, ethers v6, deterministic local LLM mock, optional Anthropic client wrapper.

---

### Task 1: Project Harness And Shared Schemas

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `shared/schemas.ts`
- Create: `shared/addresses.json`

- [x] **Step 1: Write test harness configuration**

Create npm scripts for `test`, `typecheck`, `demo`, and `selfcheck`.

- [x] **Step 2: Define shared schemas**

Export the frozen enum values and structural types from the design docs:

```ts
export enum Side {
  Commit = 0,
  Skeptic = 1,
}

export enum Outcome {
  Pending = 0,
  Kept = 1,
  Breached = 2,
}

export enum PredType {
  ONCHAIN_MILESTONE = 1,
  WHITELIST_OUTFLOW = 2,
  HABIT = 3,
  POLICY = 4,
}
```

### Task 2: Red Tests For Brain Selfcheck

**Files:**
- Create: `test/brain-module.test.ts`

- [ ] **Step 1: Write failing tests**

Cover predicate compile, pricing monotonicity, bet threshold and direction, onchain verifier, signing recovery, deterministic LLM mock, and kept/breached demo paths.

- [ ] **Step 2: Run tests to verify red**

Run: `npm test`

Expected: fail because module implementation files do not exist yet.

### Task 3: Predicate And LLM Layer

**Files:**
- Create: `agents/predicate/types.ts`
- Create: `agents/predicate/compile.ts`
- Create: `llm/mock.ts`
- Create: `llm/client.ts`

- [ ] **Step 1: Implement deterministic LLM mock**

Return stable structured output for the same prompt and tier without requiring an API key.

- [ ] **Step 2: Implement predicate compiler**

Convert `"Q3 主网上线"` with tier `L2` into an `ONCHAIN_MILESTONE` predicate whose `params.target` is a deterministic address-like value and whose `paramsBlob` is ABI encoded.

### Task 4: Ledger Boundary And Local Mock

**Files:**
- Create: `agents/base/ledger.ts`
- Create: `agents/base/runtime.ts`
- Create: `mocks/LocalLedgerMock.ts`

- [ ] **Step 1: Implement LocalLedgerMock**

Expose `createPact`, `takePosition`, `submitVerdict`, `impliedBreachProb`, `getPact`, `getProfile`, and event subscription methods matching the future contract wrapper.

- [ ] **Step 2: Implement ledger factory**

Use `MODE=mock` by default and keep real-contract mode as an explicit unsupported placeholder until module one provides addresses and ABIs.

### Task 5: Verifier And Signing

**Files:**
- Create: `agents/verifier/index.ts`
- Create: `agents/verifier/onchain.ts`
- Create: `agents/verifier/habit.ts`
- Create: `agents/verifier/policy.ts`
- Create: `agents/verifier/sign.ts`

- [ ] **Step 1: Implement verdict digest and EIP-191 signature**

Use `keccak256(abi.encode(pactId, uint8(outcome), evidenceHash))`, sign with `wallet.signMessage(getBytes(digest))`, and expose recovery for selfcheck.

- [ ] **Step 2: Implement tier routing**

Route L2 to deterministic onchain verification and provide mock L1/L3 verdict paths with evidence hashes.

### Task 6: Skeptic And Coach Agents

**Files:**
- Create: `agents/skeptic/features.ts`
- Create: `agents/skeptic/price.ts`
- Create: `agents/skeptic/bet.ts`
- Create: `agents/coach/nudge.ts`

- [ ] **Step 1: Implement pricing features**

Read the profile from the ledger boundary and transform reputation history into pricing features.

- [ ] **Step 2: Implement pricing and betting**

Return a breach probability in `[0, 1]`; bet only when `abs(pHat - pMkt) > edge`, choosing `Skeptic` when `pHat > pMkt` and `Commit` when `pHat < pMkt`.

- [ ] **Step 3: Implement L1 coach nudges**

Return deterministic coaching actions for habit predicates without mutating ledger state.

### Task 7: Demo And Selfcheck

**Files:**
- Create: `scripts/demo.ts`
- Create: `scripts/selfcheck.ts`

- [ ] **Step 1: Implement demo**

Run kept and breached paths on `LocalLedgerMock`: compile predicate, create pact, let skeptic evaluate and place a position, submit verdict, settle, print summary.

- [ ] **Step 2: Implement selfcheck**

Assert all seven module-two selfchecks from `docs/模块二_Brain_方案.md`.

- [ ] **Step 3: Verify**

Run:

```bash
npm test
npm run typecheck
npm run selfcheck
npm run demo -- --path kept
npm run demo -- --path breach
```

Expected: all pass locally in `MODE=mock` without module-one code.
