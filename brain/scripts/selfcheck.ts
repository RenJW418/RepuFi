import { strict as assert } from "node:assert";
import { pathToFileURL } from "node:url";

import { Wallet } from "ethers";

import { createLedger } from "../agents/base/ledger.js";
import { compilePredicate } from "../agents/predicate/compile.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { verifyOnchainMilestone } from "../agents/verifier/onchain.js";
import { recoverVerdictSigner, signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { Outcome, PredType, Side, type CredibilityProfile } from "../shared/schemas.js";
import { runBrainDemo } from "./demo.js";

const subject = "0x1000000000000000000000000000000000000001" as const;
const verifierPrivateKey =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";

export async function runSelfcheck(): Promise<string[]> {
  const checks: string[] = [];
  const predicate = await compilePredicate({
    goal: "Q3 主网上线",
    tier: "L2",
    llm: createMockLlm(),
  });
  assert.equal(predicate.predType, PredType.ONCHAIN_MILESTONE);
  assert.match(predicate.paramsBlob, /^0x[0-9a-f]+$/);
  checks.push("predicate compile");

  const clean: CredibilityProfile = {
    subject,
    score: 10_000n,
    kept: 8,
    broken: 0,
    totalBond: 1n,
    permanentStain: false,
  };
  const risky: CredibilityProfile = {
    subject,
    score: -1_000n,
    kept: 1,
    broken: 5,
    totalBond: 1n,
    permanentStain: true,
  };
  const cleanPrice = priceBreachProbability(extractPricingFeatures(clean));
  const riskyPrice = priceBreachProbability(extractPricingFeatures(risky));
  assert(cleanPrice >= 0 && cleanPrice <= 1);
  assert(riskyPrice > cleanPrice);
  checks.push("pricing monotonicity");

  const ledger = createLedger({ mode: "mock" });
  const pact = await ledger.createPact({
    subject,
    predType: PredType.ONCHAIN_MILESTONE,
    paramsBlob: predicate.paramsBlob,
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
  const skepticBet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability: 0.8,
    edge: 0.05,
    amount: 10n,
  });
  assert.equal(noBet.placed, false);
  assert.equal(skepticBet.placed, true);
  assert.equal(skepticBet.side, Side.Skeptic);
  checks.push("bet threshold and direction");

  const breached = await verifyOnchainMilestone({
    pactId: `0x${"1".padStart(64, "0")}`,
    target: "0x2000000000000000000000000000000000000002",
    chainState: { deployedAddresses: [] },
  });
  assert.equal(breached.outcome, Outcome.Breached);
  checks.push("onchain verifier");

  const wallet = new Wallet(verifierPrivateKey);
  const signed = await signVerdict({
    wallet,
    pactId: `0x${"1".padStart(64, "0")}`,
    outcome: Outcome.Breached,
    evidenceHash: breached.evidenceHash,
  });
  assert.equal(recoverVerdictSigner(signed), wallet.address);
  checks.push("signature recovery");

  const llm = createMockLlm();
  const first = await llm.completeStructured({ task: "compile-predicate", goal: "Q3 主网上线", tier: "L2" });
  const second = await llm.completeStructured({ task: "compile-predicate", goal: "Q3 主网上线", tier: "L2" });
  assert.deepEqual(first, second);
  checks.push("llm deterministic mock");

  const keptDemo = await runBrainDemo({ path: "kept", silent: true });
  const breachDemo = await runBrainDemo({ path: "breach", silent: true });
  assert.equal(keptDemo.settlement.outcome, Outcome.Kept);
  assert.equal(breachDemo.settlement.outcome, Outcome.Breached);
  checks.push("demo kept and breach paths");

  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSelfcheck()
    .then((checks) => {
      for (const check of checks) {
        console.log(`ok - ${check}`);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
