import { pathToFileURL } from "node:url";

import { AbiCoder, Wallet, keccak256, toUtf8Bytes } from "ethers";

import { RepuFiLedgerClient } from "../agents/base/repuFiLedger.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { signVerdict } from "../agents/verifier/sign.js";
import { Outcome, PredType, type Hex } from "../shared/schemas.js";

const hardhatSubjectKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const hardhatSkepticKey = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const hardhatVerifierKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export async function runRepuFiSmoke(): Promise<{
  pactId: Hex;
  betPlaced: boolean;
  outcome: Outcome;
  profileBroken: number;
}> {
  const subjectWallet = new Wallet(process.env.PRIVATE_KEY_SUBJECT ?? hardhatSubjectKey);
  const verifierWallet = new Wallet(process.env.PRIVATE_KEY_VERIFIER ?? hardhatVerifierKey);
  const ledger = new RepuFiLedgerClient({
    subjectPrivateKey: subjectWallet.privateKey,
    skepticPrivateKey: process.env.PRIVATE_KEY_SKEPTIC ?? hardhatSkepticKey,
    verifierPrivateKey: verifierWallet.privateKey,
  });

  const paramsBlob = AbiCoder.defaultAbiCoder().encode(
    ["address"],
    ["0x0000000000000000000000000000000000000000"],
  ) as Hex;
  const deadline = Math.floor(Date.now() / 1000) + 3_600;
  const pact = await ledger.createPact({
    subject: subjectWallet.address as Hex,
    predType: PredType.ONCHAIN_MILESTONE,
    paramsBlob,
    deadline,
    bond: 10_000_000_000_000_000n,
  });

  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability: 0.8,
    edge: 0.05,
    amount: 10_000_000_000_000_000n,
  });

  const evidenceHash = keccak256(toUtf8Bytes("repuFi-smoke-breach")) as Hex;
  const verdict = await signVerdict({
    wallet: verifierWallet,
    pactId: pact.pactId,
    outcome: Outcome.Breached,
    evidenceHash,
  });
  const settlement = await ledger.submitVerdict(verdict);
  const profile = await ledger.getProfile(subjectWallet.address as Hex);

  return {
    pactId: pact.pactId,
    betPlaced: bet.placed,
    outcome: settlement.outcome,
    profileBroken: profile.broken,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRepuFiSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
