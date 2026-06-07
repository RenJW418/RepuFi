import { pathToFileURL } from "node:url";

import { Wallet } from "ethers";

import { createLedger } from "../agents/base/ledger.js";
import { compilePredicate } from "../agents/predicate/compile.js";
import type { OnchainMilestoneParams } from "../agents/predicate/types.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { verifyOnchainMilestone } from "../agents/verifier/onchain.js";
import { signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { type CredibilityProfile, Outcome, PredType, type Hex } from "../shared/schemas.js";

const subject = "0x1000000000000000000000000000000000000001" as Hex;
const verifierPrivateKey =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";

export type DemoPath = "kept" | "breach";

export interface DemoResult {
  path: DemoPath;
  pactId: `0x${string}`;
  predicate: Awaited<ReturnType<typeof compilePredicate>>;
  modelBreachProbability: number;
  bet: Awaited<ReturnType<typeof decideAndPlaceBet>>;
  verdict: Awaited<ReturnType<typeof signVerdict>>;
  settlement: {
    pactId: `0x${string}`;
    outcome: Outcome;
    evidenceHash: `0x${string}`;
    difficulty: number;
    subject: Hex;
  };
  profile: CredibilityProfile;
}

export async function runBrainDemo(input: {
  path: DemoPath;
  silent?: boolean;
}): Promise<DemoResult> {
  const ledger = createLedger({ mode: "mock" });
  const predicate = await compilePredicate({
    goal: "Q3 主网上线",
    tier: "L2",
    llm: createMockLlm(),
  });

  if (predicate.predType !== PredType.ONCHAIN_MILESTONE || predicate.params.kind !== "contract_deployed") {
    throw new Error("Demo expects an L2 onchain milestone predicate.");
  }

  const pact = await ledger.createPact({
    subject,
    predType: predicate.predType,
    paramsBlob: predicate.paramsBlob,
    deadline: 2_000_000_000,
    bond: 1_000_000_000_000_000_000n,
  });

  const profile = await ledger.getProfile(subject);
  const modelBreachProbability = priceBreachProbability(extractPricingFeatures(profile));
  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability,
    edge: 0.05,
    amount: 100_000_000_000_000_000n,
  });

  const params = predicate.params as OnchainMilestoneParams;
  const verification = await verifyOnchainMilestone({
    pactId: pact.pactId,
    target: params.target,
    chainState: {
      deployedAddresses: input.path === "kept" ? [params.target] : [],
    },
  });
  const verdict = await signVerdict({
    wallet: new Wallet(verifierPrivateKey),
    pactId: pact.pactId,
    outcome: verification.outcome,
    evidenceHash: verification.evidenceHash,
  });
  const settlement = await ledger.submitVerdict(verdict);
  const updatedProfile = await ledger.getProfile(subject);

  const result: DemoResult = {
    path: input.path,
    pactId: pact.pactId,
    predicate,
    modelBreachProbability,
    bet,
    verdict,
    settlement,
    profile: updatedProfile,
  };

  if (!input.silent) {
    printDemoResult(result);
  }

  return result;
}

function printDemoResult(result: DemoResult): void {
  const outcome = result.settlement.outcome === Outcome.Kept ? "Kept" : "Breached";
  console.log(
    JSON.stringify(
      {
        path: result.path,
        pactId: result.pactId,
        predType: result.predicate.predType,
        modelBreachProbability: result.modelBreachProbability,
        bet: {
          placed: result.bet.placed,
          side: result.bet.side,
          amount: result.bet.amount.toString(),
        },
        outcome,
        score: result.profile.score.toString(),
        kept: result.profile.kept,
        broken: result.profile.broken,
      },
      null,
      2,
    ),
  );
}

function parsePath(argv: string[]): DemoPath {
  const pathIndex = argv.indexOf("--path");
  const value = pathIndex >= 0 ? argv[pathIndex + 1] : "kept";
  if (value !== "kept" && value !== "breach") {
    throw new Error('Usage: npm run demo -- --path kept|breach');
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrainDemo({ path: parsePath(process.argv) }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
