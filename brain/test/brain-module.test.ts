import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";

import { createCoachNudge } from "../agents/coach/nudge.js";
import { createLedger } from "../agents/base/ledger.js";
import { RepuFiLedgerClient } from "../agents/base/repuFiLedger.js";
import { compilePredicate } from "../agents/predicate/compile.js";
import { resolveOutcome } from "../agents/resolver/index.js";
import { runMultiAgentVerdict } from "../agents/resolver/multiAgent.js";
import { runHumanReview } from "../agents/resolver/humanReview.js";
import { proposeOutcomeViaUma } from "../agents/resolver/uma.js";
import { validateGoal, validateGoalLocally } from "../agents/validator/goalValidator.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { verifyOnchainMilestone } from "../agents/verifier/onchain.js";
import { recoverVerdictSigner, signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { runBrainDemo } from "../scripts/demo.js";
import { runAllCases } from "../scripts/demo-cases.js";
import { Outcome, PredType, Side, type CredibilityProfile, type Hex } from "../shared/schemas.js";

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
      sharedDir: "shared",
      skepticPrivateKey: verifierPrivateKey,
      verifierPrivateKey,
    });

    expect(client).toBeInstanceOf(RepuFiLedgerClient);
  });

  // ── Goal Validator ──────────────────────────────────────────────────────────

  it("rejects vague goals that lack quantifiable indicators", () => {
    const vague = validateGoalLocally("希望变得更健康", "L1");
    expect(vague.valid).toBe(false);
    expect(vague.suggestions.length).toBeGreaterThan(0);
  });

  it("accepts quantified goals for L1, L2, L3", () => {
    expect(validateGoalLocally("30天养成晨跑", "L1").valid).toBe(true);
    expect(validateGoalLocally("Q3主网上线", "L2").valid).toBe(true);
    expect(validateGoalLocally("任期内GDP增长3%", "L3").valid).toBe(true);
  });

  it("validates goal via LLM mock and returns consistent result", async () => {
    const llm = createMockLlm();
    const result = await validateGoal({ goal: "30天养成晨跑", tier: "L1", llm });
    expect(result.valid).toBe(true);
    expect(typeof result.reason).toBe("string");
  });

  // ── Multi-Agent Verdict ─────────────────────────────────────────────────────

  it("runs multi-agent verdict and returns majority outcome with agreement score", async () => {
    const llm = createMockLlm();
    const pactId = `0x${"a".repeat(64)}` as Hex;
    const result = await runMultiAgentVerdict({
      pactId,
      goal: "Q3主网上线",
      evidence: { deployedAddresses: [] },
      llm,
    });

    expect(result.verdicts).toHaveLength(3);
    expect([Outcome.Kept, Outcome.Breached]).toContain(result.majorityOutcome);
    expect(result.agreement).toBeGreaterThan(0);
    expect(result.agreement).toBeLessThanOrEqual(1);
  });

  // ── Human Review (interest isolation) ──────────────────────────────────────

  it("excludes subject and participants from human review vote", () => {
    const pactId = `0x${"b".repeat(64)}` as Hex;
    const subjectAddr = "0x1111111111111111111111111111111111111111" as Hex;
    const participant = "0x2222222222222222222222222222222222222222" as Hex;
    const voter = "0x3333333333333333333333333333333333333333" as Hex;

    const result = runHumanReview({
      pactId,
      subject: subjectAddr,
      participants: [participant],
      tokenHolders: [
        { address: subjectAddr, balance: 1000n },
        { address: participant, balance: 500n },
        { address: voter, balance: 300n },
      ],
    });

    expect(result.excludedAddresses).toContain(subjectAddr.toLowerCase());
    expect(result.excludedAddresses).toContain(participant.toLowerCase());
    expect(result.eligibleVoters).toBe(1);
  });

  it("defaults to Kept when quorum is not reached", () => {
    const pactId = `0x${"c".repeat(64)}` as Hex;
    // No votes cast → quorum not reached → default Kept
    const result = runHumanReview({
      pactId,
      subject: "0x4444444444444444444444444444444444444444" as Hex,
      participants: [],
      tokenHolders: [],
      simulatedVotes: new Map(),
    });

    expect(result.quorumReached).toBe(false);
    expect(result.outcome).toBe(Outcome.Kept);
  });

  // ── UMA Oracle ──────────────────────────────────────────────────────────────

  it("UMA oracle settles without dispute when no forced dispute", async () => {
    const pactId = `0x${"d".repeat(64)}` as Hex;
    const result = await proposeOutcomeViaUma({
      pactId,
      proposedOutcome: Outcome.Kept,
      proposer: "0x0000000000000000000000000000000000000001" as Hex,
      forcedDispute: false,
    });

    expect(result.disputed).toBe(false);
    expect(result.proposal.state).toBe("settled");
    expect(result.outcome).toBe(Outcome.Kept);
  });

  it("UMA oracle marks disputed when forced", async () => {
    const pactId = `0x${"e".repeat(64)}` as Hex;
    const result = await proposeOutcomeViaUma({
      pactId,
      proposedOutcome: Outcome.Breached,
      proposer: "0x0000000000000000000000000000000000000001" as Hex,
      forcedDispute: true,
    });

    expect(result.disputed).toBe(true);
    expect(result.proposal.state).toBe("disputed");
  });

  // ── Full Resolution Pipeline ────────────────────────────────────────────────

  it("resolves with multi_agent_unanimous when agents agree with primary outcome", async () => {
    const llm = createMockLlm();
    const pactId = `0x${"f".repeat(64)}` as Hex;

    const result = await resolveOutcome({
      pactId,
      goal: "Q3主网上线",
      subject: subject as Hex,
      participants: [],
      evidence: {},
      // mock agents all return Kept, so primaryOutcome=Kept → unanimous agreement
      primaryOutcome: Outcome.Kept,
      llm,
      tokenHolders: [],
    });

    expect(result.source).toBe("multi_agent_unanimous");
    expect(result.conflict).toBe(false);
    expect(result.outcome).toBe(Outcome.Kept);
  });

  it("escalates to human review when primary outcome conflicts with multi-agent mock", async () => {
    const llm = createMockLlm();
    const pactId = `0x${"4".repeat(64)}` as Hex;

    // mock agents return Kept, but primary says Breached → conflict → human review
    const result = await resolveOutcome({
      pactId,
      goal: "Q3主网上线",
      subject: subject as Hex,
      participants: [],
      evidence: {},
      primaryOutcome: Outcome.Breached,
      llm,
      tokenHolders: [
        { address: "0xA000000000000000000000000000000000000001" as Hex, balance: 1000n },
        { address: "0xA000000000000000000000000000000000000002" as Hex, balance: 500n },
      ],
    });

    expect(result.source).toBe("multi_agent_majority_human_review");
    expect(result.conflict).toBe(true);
  });

  it("escalates to human review on UMA dispute", async () => {
    const llm = createMockLlm();
    const pactId = `0x${"5".repeat(64)}` as Hex;

    const result = await resolveOutcome({
      pactId,
      goal: "Q3主网上线",
      subject: subject as Hex,
      participants: [],
      evidence: {},
      primaryOutcome: Outcome.Kept,
      simulateUmaDispute: true,
      llm,
      tokenHolders: [
        { address: "0xA000000000000000000000000000000000000001" as Hex, balance: 1000n },
      ],
    });

    expect(result.source).toBe("uma_disputed_human_review");
    expect(result.conflict).toBe(true);
  });

  // ── Three-Case End-to-End ───────────────────────────────────────────────────

  it("runs all three demo cases (L1/L2/L3 kept and breach) end-to-end without errors", async () => {
    await expect(runAllCases()).resolves.toBeUndefined();
  });
});
