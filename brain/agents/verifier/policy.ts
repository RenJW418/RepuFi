import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32 } from "../../shared/schemas.js";

export async function verifyPolicyEvidence(input: {
  pactId: Bytes32;
  positiveSources: string[];
  negativeSources: string[];
}): Promise<{ pactId: Bytes32; outcome: Outcome.Kept | Outcome.Breached; evidenceHash: Bytes32 }> {
  const kept = input.positiveSources.length >= input.negativeSources.length;
  return {
    pactId: input.pactId,
    outcome: kept ? Outcome.Kept : Outcome.Breached,
    evidenceHash: keccak256(toUtf8Bytes(JSON.stringify(input))) as Bytes32,
  };
}
