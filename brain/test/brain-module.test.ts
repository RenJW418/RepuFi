import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Wallet } from "ethers";

import { createCoachNudge } from "../agents/coach/nudge.js";
import { reviewGoalIntake } from "../agents/intake/review.js";
import { createGoalIntakeHttpServer } from "../agents/intake/server.js";
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
import { mdScenarioDefinitions, runMdScenarioMatrix } from "../scripts/scenarios.js";
import { Outcome, PredType, Side, type CredibilityProfile } from "../shared/schemas.js";
import { demoScenarioTemplates, scenarioById } from "../../ledger/shared/demoWorkflow.js";

const subject = "0x1000000000000000000000000000000000000001" as const;
const verifierPrivateKey =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";

async function listenOnEphemeralPort(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on an ephemeral TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("Brain module selfcheck", () => {
  it("rejects broad goal intake before predicate compilation", () => {
    const decision = reviewGoalIntake({
      goal: "我要变得更好",
      stakeEth: "1",
      scenarioId: "l1-habit",
    });

    expect(decision.accepted).toBe(false);
    expect(decision.predicate).toBeUndefined();
    expect(decision.analysis.reasons).toEqual(
      expect.arrayContaining(["目标缺少可量化数字", "目标缺少明确到期时间", "目标缺少客观证据来源"]),
    );
  });

  it("accepts the three MD demo goals and returns publishable predicates", () => {
    const decisions = demoScenarioTemplates.map((scenario) =>
      reviewGoalIntake({
        goal: scenario.goal,
        stakeEth: scenario.defaultStakeEth,
        scenarioId: scenario.id,
      }),
    );

    expect(decisions.every((decision) => decision.accepted)).toBe(true);
    expect(decisions.map((decision) => decision.analysis.tier)).toEqual(["L1", "L2", "L3"]);
    expect(decisions.map((decision) => decision.predicate?.predType)).toEqual([
      PredType.HABIT,
      PredType.ONCHAIN_MILESTONE,
      PredType.POLICY,
    ]);
    for (const decision of decisions) {
      expect(decision.predicate?.paramsBlob).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it("serves backend goal intake review over HTTP for the website", async () => {
    const server = createGoalIntakeHttpServer();
    const baseUrl = await listenOnEphemeralPort(server);

    try {
      const rejected = await fetch(`${baseUrl}/api/intake/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "我要变得更好", stakeEth: "1", scenarioId: "l1-habit" }),
      });
      const rejectedBody = await rejected.json();

      expect(rejected.status).toBe(200);
      expect(rejectedBody.accepted).toBe(false);
      expect(rejectedBody.predicate).toBeUndefined();

      const deliveryScenario = scenarioById("l2-delivery");
      const accepted = await fetch(`${baseUrl}/api/intake/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: deliveryScenario.goal,
          stakeEth: deliveryScenario.defaultStakeEth,
          scenarioId: deliveryScenario.id,
        }),
      });
      const acceptedBody = await accepted.json();

      expect(accepted.status).toBe(200);
      expect(acceptedBody.accepted).toBe(true);
      expect(acceptedBody.predicate.predType).toBe(PredType.ONCHAIN_MILESTONE);
      expect(acceptedBody.predicate.paramsBlob).toMatch(/^0x[0-9a-f]+$/);
    } finally {
      await closeServer(server);
    }
  });

  it("allows browser CORS preflight for the goal intake endpoint", async () => {
    const server = createGoalIntakeHttpServer();
    const baseUrl = await listenOnEphemeralPort(server);

    try {
      const response = await fetch(`${baseUrl}/api/intake/review`, {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    } finally {
      await closeServer(server);
    }
  });

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

  it("runs the MD scenario matrix across L1, L2, and L3 kept/breach paths", async () => {
    const scenarios = await runMdScenarioMatrix({ silent: true });

    expect(scenarios).toHaveLength(mdScenarioDefinitions.length);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "l1-habit-kept",
      "l1-habit-breach",
      "l2-delivery-kept",
      "l2-delivery-breach",
      "l3-policy-kept",
      "l3-policy-breach",
    ]);
    for (const scenario of scenarios) {
      expect(scenario.bet.placed).toBe(true);
      expect(scenario.marketBreachProbability).toBe(0.5);
      if (scenario.path === "kept") {
        expect(scenario.outcome).toBe(Outcome.Kept);
        expect(scenario.finalProfile.kept).toBe(scenario.initialProfile.kept + 1);
        expect(scenario.finalProfile.score).toBeGreaterThan(scenario.initialProfile.score);
      } else {
        expect(scenario.outcome).toBe(Outcome.Breached);
        expect(scenario.finalProfile.broken).toBe(scenario.initialProfile.broken + 1);
        expect(scenario.finalProfile.permanentStain).toBe(true);
        expect(scenario.finalProfile.score).toBeLessThan(scenario.initialProfile.score);
      }
    }
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
      sharedDir: "../ledger/shared",
      skepticPrivateKey: verifierPrivateKey,
      verifierPrivateKey,
    });

    expect(client).toBeInstanceOf(RepuFiLedgerClient);
  });
});
