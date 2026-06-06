import { strict as assert } from "node:assert";
import { pathToFileURL } from "node:url";

import { Wallet } from "ethers";

import { compilePredicate } from "../agents/predicate/compile.js";
import type { PredicateSpec } from "../agents/predicate/types.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { verifyPredicate } from "../agents/verifier/index.js";
import { recoverVerdictSigner, signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { LocalLedgerMock } from "../mocks/LocalLedgerMock.js";
import { Outcome, Side, type CredibilityProfile, type Hex, type Tier } from "../shared/schemas.js";

const verifierPrivateKey =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";
const bond = 1_000_000_000_000_000_000n;
const backgroundLiquidity = 200_000_000_000_000_000n;
const betAmount = 100_000_000_000_000_000n;
const deadline = 2_000_000_000;

export type ScenarioPath = "kept" | "breach";

export interface MdScenarioDefinition {
  id: string;
  tier: Tier;
  goal: string;
  path: ScenarioPath;
  expectedBetSide: Side;
}

export interface MdScenarioResult {
  id: string;
  tier: Tier;
  goal: string;
  path: ScenarioPath;
  pactId: `0x${string}`;
  predType: number;
  modelBreachProbability: number;
  marketBreachProbability: number;
  bet: {
    placed: boolean;
    side?: Side;
    amount: string;
  };
  outcome: Outcome.Kept | Outcome.Breached;
  recoveredSigner: Hex;
  initialProfile: CredibilityProfile;
  finalProfile: CredibilityProfile;
}

export const mdScenarioDefinitions: MdScenarioDefinition[] = [
  {
    id: "l1-habit-kept",
    tier: "L1",
    goal: "30 天养成晨跑",
    path: "kept",
    expectedBetSide: Side.Commit,
  },
  {
    id: "l1-habit-breach",
    tier: "L1",
    goal: "30 天养成晨跑",
    path: "breach",
    expectedBetSide: Side.Skeptic,
  },
  {
    id: "l2-delivery-kept",
    tier: "L2",
    goal: "Q3 主网上线",
    path: "kept",
    expectedBetSide: Side.Commit,
  },
  {
    id: "l2-delivery-breach",
    tier: "L2",
    goal: "Q3 主网上线",
    path: "breach",
    expectedBetSide: Side.Skeptic,
  },
  {
    id: "l3-policy-kept",
    tier: "L3",
    goal: "任期内公共服务指标提升到 80%",
    path: "kept",
    expectedBetSide: Side.Commit,
  },
  {
    id: "l3-policy-breach",
    tier: "L3",
    goal: "任期内公共服务指标提升到 80%",
    path: "breach",
    expectedBetSide: Side.Skeptic,
  },
];

export async function runMdScenario(input: {
  definition: MdScenarioDefinition;
  index: number;
}): Promise<MdScenarioResult> {
  const wallet = new Wallet(verifierPrivateKey);
  const ledger = new LocalLedgerMock();
  const subject = subjectForIndex(input.index);
  ledger.setProfile(seedProfile(subject, input.definition.path));

  const predicate = await compilePredicate({
    goal: input.definition.goal,
    tier: input.definition.tier,
    llm: createMockLlm(),
  });
  const pact = await ledger.createPact({
    subject,
    predType: predicate.predType,
    paramsBlob: predicate.paramsBlob,
    deadline,
    bond,
  });
  await seedBalancedMarket(ledger, pact.pactId);

  const initialProfile = await ledger.getProfile(subject);
  const modelBreachProbability = priceBreachProbability(extractPricingFeatures(initialProfile));
  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability,
    edge: 0.05,
    amount: betAmount,
  });
  const verification = await verifyPredicate({
    pactId: pact.pactId,
    predicate,
    evidence: evidenceFor(input.definition, predicate),
  });
  const verdict = await signVerdict({
    wallet,
    pactId: pact.pactId,
    outcome: verification.outcome,
    evidenceHash: verification.evidenceHash,
  });
  const recoveredSigner = recoverVerdictSigner(verdict);
  const settlement = await ledger.submitVerdict(verdict);
  const finalProfile = await ledger.getProfile(subject);

  const result: MdScenarioResult = {
    id: input.definition.id,
    tier: input.definition.tier,
    goal: input.definition.goal,
    path: input.definition.path,
    pactId: pact.pactId,
    predType: predicate.predType,
    modelBreachProbability,
    marketBreachProbability: bet.marketBreachProbability,
    bet: {
      placed: bet.placed,
      side: bet.side,
      amount: bet.amount.toString(),
    },
    outcome: settlement.outcome as Outcome.Kept | Outcome.Breached,
    recoveredSigner,
    initialProfile,
    finalProfile,
  };

  assertMdScenarioResult(result, input.definition, wallet.address as Hex);
  return result;
}

export async function runMdScenarioMatrix(input: {
  silent?: boolean;
} = {}): Promise<MdScenarioResult[]> {
  const results: MdScenarioResult[] = [];
  for (const [index, definition] of mdScenarioDefinitions.entries()) {
    results.push(await runMdScenario({ definition, index }));
  }

  if (!input.silent) {
    printScenarioMatrix(results);
  }

  return results;
}

function assertMdScenarioResult(
  result: MdScenarioResult,
  definition: MdScenarioDefinition,
  verifierAddress: Hex,
): void {
  const expectedOutcome = definition.path === "kept" ? Outcome.Kept : Outcome.Breached;
  assert.equal(result.outcome, expectedOutcome, `${definition.id} outcome`);
  assert.equal(result.recoveredSigner, verifierAddress, `${definition.id} recovered verifier`);
  assert.equal(result.marketBreachProbability, 0.5, `${definition.id} starts at the empty-market price`);
  assert.equal(result.bet.placed, true, `${definition.id} places an agent position`);
  assert.equal(result.bet.side, definition.expectedBetSide, `${definition.id} bet side`);

  if (expectedOutcome === Outcome.Kept) {
    assert.equal(result.finalProfile.kept, result.initialProfile.kept + 1, `${definition.id} kept count`);
    assert.equal(result.finalProfile.broken, result.initialProfile.broken, `${definition.id} broken count`);
    assert(result.finalProfile.score > result.initialProfile.score, `${definition.id} score increases`);
  } else {
    assert.equal(result.finalProfile.broken, result.initialProfile.broken + 1, `${definition.id} broken count`);
    assert.equal(result.finalProfile.permanentStain, true, `${definition.id} permanent stain`);
    assert(result.finalProfile.score < result.initialProfile.score, `${definition.id} score decreases`);
  }
}

function seedProfile(subject: Hex, path: ScenarioPath): CredibilityProfile {
  if (path === "kept") {
    return {
      subject,
      score: 5_000_000_000_000_000_000n,
      kept: 5,
      broken: 0,
      totalBond: 5_000_000_000_000_000_000n,
      permanentStain: false,
    };
  }

  return {
    subject,
    score: -2_000_000_000_000_000_000n,
    kept: 1,
    broken: 5,
    totalBond: 6_000_000_000_000_000_000n,
    permanentStain: true,
  };
}

async function seedBalancedMarket(ledger: LocalLedgerMock, pactId: `0x${string}`): Promise<void> {
  await ledger.takePosition({
    pactId,
    side: Side.Commit,
    amount: backgroundLiquidity,
    trader: "0x2000000000000000000000000000000000000001",
  });
  await ledger.takePosition({
    pactId,
    side: Side.Skeptic,
    amount: backgroundLiquidity,
    trader: "0x2000000000000000000000000000000000000002",
  });
}

function evidenceFor(definition: MdScenarioDefinition, predicate: PredicateSpec): Record<string, unknown> {
  if (definition.tier === "L1" && predicate.params.kind === "habit_checkin") {
    return {
      completedCheckins:
        definition.path === "kept" ? predicate.params.requiredDays : Math.max(0, predicate.params.requiredDays - 8),
    };
  }

  if (definition.tier === "L2" && predicate.params.kind === "contract_deployed") {
    return {
      deployedAddresses: definition.path === "kept" ? [predicate.params.target] : [],
    };
  }

  if (definition.path === "kept") {
    return {
      positiveSources: ["mock://policy/primary", "mock://policy/secondary"],
      negativeSources: ["mock://policy/dispute"],
    };
  }

  return {
    positiveSources: ["mock://policy/campaign-claim"],
    negativeSources: ["mock://policy/audit", "mock://policy/public-dataset"],
  };
}

function subjectForIndex(index: number): Hex {
  return `0x${(0x1000n + BigInt(index)).toString(16).padStart(40, "0")}` as Hex;
}

function printScenarioMatrix(results: MdScenarioResult[]): void {
  console.log(
    JSON.stringify(
      {
        scenarios: results.map((result) => ({
          id: result.id,
          tier: result.tier,
          path: result.path,
          predType: result.predType,
          modelBreachProbability: result.modelBreachProbability,
          marketBreachProbability: result.marketBreachProbability,
          bet: result.bet,
          outcome: result.outcome === Outcome.Kept ? "Kept" : "Breached",
          profileDelta: {
            score: (result.finalProfile.score - result.initialProfile.score).toString(),
            kept: result.finalProfile.kept - result.initialProfile.kept,
            broken: result.finalProfile.broken - result.initialProfile.broken,
            permanentStain: result.finalProfile.permanentStain,
          },
        })),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMdScenarioMatrix().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
