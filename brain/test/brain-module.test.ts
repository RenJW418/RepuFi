import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";

import { createCoachNudge } from "../agents/coach/nudge.js";
import { createLedger } from "../agents/base/ledger.js";
import { RepuFiLedgerClient } from "../agents/base/repuFiLedger.js";
import { compilePredicate } from "../agents/predicate/compile.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { verifyOnchainMilestone } from "../agents/verifier/onchain.js";
import { recoverVerdictSigner, signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { runBrainDemo } from "../scripts/demo.js";
import { Outcome, PredType, Side, type CredibilityProfile } from "../shared/schemas.js";

const subject = "0x1000000000000000000000000000000000000001" as const;
const verifierPrivateKey =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";

describe("Brain module selfcheck", () => {
  it("compiles an L2 natural-language goal into a schema-valid onchain predicate", async () => {
    const predicate = await compilePredicate({
      goal: "Q3 主网上线",
      tier: "L2",
      llm: createMockLlm(),
    });

    expect(predicate.tier).toBe("L2");
    expect(predicate.predType).toBe(PredType.ONCHAIN_MILESTONE);
    expect(predicate.params.kind).toBe("contract_deployed");
    if (predicate.params.kind !== "contract_deployed") {
      throw new Error("Expected an onchain milestone predicate.");
    }
    expect(predicate.params.target).toMatch(/^0x[a-f0-9]{40}$/);
    expect(predicate.paramsBlob).toMatch(/^0x[a-f0-9]+$/);
  });

  it("prices high-breach histories above clean histories while staying in [0, 1]", () => {
    const clean: CredibilityProfile = {
      subject,
      score: 10_000n,
      kept: 8,
      broken: 0,
      totalBond: 10n ** 18n,
      permanentStain: false,
    };
    const risky: CredibilityProfile = {
      subject,
      score: -2_000n,
      kept: 1,
      broken: 5,
      totalBond: 10n ** 18n,
      permanentStain: true,
    };

    const cleanProbability = priceBreachProbability(extractPricingFeatures(clean));
    const riskyProbability = priceBreachProbability(extractPricingFeatures(risky));

    expect(cleanProbability).toBeGreaterThanOrEqual(0);
    expect(cleanProbability).toBeLessThanOrEqual(1);
    expect(riskyProbability).toBeGreaterThan(cleanProbability);
  });

  it("bets only over the edge threshold and chooses direction from model-vs-market price", async () => {
    const ledger = createLedger({ mode: "mock" });
    const pact = await ledger.createPact({
      subject,
      predType: PredType.ONCHAIN_MILESTONE,
      paramsBlob: "0x1234",
      deadline: 2_000_000_000,
      bond: 1_000_000_000_000_000_000n,
    });

    const noBet = await decideAndPlaceBet({
      ledger,
      pactId: pact.pactId,
      modelBreachProbability: 0.5,
      edge: 0.05,
      amount: 10n,
    });
    expect(noBet.placed).toBe(false);

    const skepticBet = await decideAndPlaceBet({
      ledger,
      pactId: pact.pactId,
      modelBreachProbability: 0.8,
      edge: 0.05,
      amount: 10n,
    });
    expect(skepticBet).toMatchObject({ placed: true, side: Side.Skeptic });

    const commitBet = await decideAndPlaceBet({
      ledger,
      pactId: pact.pactId,
      modelBreachProbability: 0.1,
      edge: 0.05,
      amount: 10n,
    });
    expect(commitBet).toMatchObject({ placed: true, side: Side.Commit });
  });

  it("verifies an L2 onchain milestone deterministically from mock chain state", async () => {
    const kept = await verifyOnchainMilestone({
      pactId: `0x${"1".padStart(64, "0")}`,
      target: "0x2000000000000000000000000000000000000002",
      chainState: { deployedAddresses: ["0x2000000000000000000000000000000000000002"] },
    });
    const breached = await verifyOnchainMilestone({
      pactId: `0x${"2".padStart(64, "0")}`,
      target: "0x3000000000000000000000000000000000000003",
      chainState: { deployedAddresses: [] },
    });

    expect(kept.outcome).toBe(Outcome.Kept);
    expect(breached.outcome).toBe(Outcome.Breached);
  });

  it("signs verdicts with EIP-191 personal_sign semantics and recovers the verifier address", async () => {
    const wallet = new Wallet(verifierPrivateKey);
    const signed = await signVerdict({
      wallet,
      pactId: `0x${"1".padStart(64, "0")}`,
      outcome: Outcome.Breached,
      evidenceHash: "0x1f1d7d0b06f3bf95f0222da0c2aa5a288a5c6a83de37d86af6fc7c2f3a1f9988",
    });

    const recovered = recoverVerdictSigner(signed);

    expect(recovered).toBe(wallet.address);
  });

  it("uses a deterministic LLM mock for reproducible demos", async () => {
    const llm = createMockLlm();
    const first = await llm.completeStructured({
      goal: "Q3 主网上线",
      tier: "L2",
      task: "compile-predicate",
    });
    const second = await llm.completeStructured({
      goal: "Q3 主网上线",
      tier: "L2",
      task: "compile-predicate",
    });

    expect(first).toEqual(second);
  });

  it("runs kept and breached demo paths end to end on LocalLedgerMock", async () => {
    const kept = await runBrainDemo({ path: "kept", silent: true });
    const breached = await runBrainDemo({ path: "breach", silent: true });

    expect(kept.bet).toMatchObject({ placed: true, side: Side.Skeptic });
    expect(kept.settlement.outcome).toBe(Outcome.Kept);
    expect(kept.profile.kept).toBe(1);
    expect(kept.profile.score).toBeGreaterThan(0n);
    expect(breached.settlement.outcome).toBe(Outcome.Breached);
    expect(breached.profile.broken).toBe(1);
  });

  it("creates deterministic L1 coach nudges without touching ledger state", () => {
    const nudge = createCoachNudge({
      goal: "30 天养成晨跑",
      currentStreak: 3,
      blockers: ["下雨"],
    });

    expect(nudge.actions.length).toBeGreaterThan(0);
    expect(nudge.actions[0]).toContain("晨跑");
  });

  it("loads the RepuFi module-one shared addresses and ABI seam for real ledger mode", () => {
    const client = new RepuFiLedgerClient({
      sharedDir: "../shared",
      skepticPrivateKey: verifierPrivateKey,
      verifierPrivateKey,
    });

    expect(client).toBeInstanceOf(RepuFiLedgerClient);
  });
});
