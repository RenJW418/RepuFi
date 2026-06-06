import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32 } from "../../shared/schemas.js";

export async function verifyHabitEvidence(input: {
  pactId: Bytes32;
  completedCheckins: number;
  requiredCheckins: number;
}): Promise<{ pactId: Bytes32; outcome: Outcome.Kept | Outcome.Breached; evidenceHash: Bytes32 }> {
  const kept = input.completedCheckins >= input.requiredCheckins;
  return {
    pactId: input.pactId,
    outcome: kept ? Outcome.Kept : Outcome.Breached,
    evidenceHash: keccak256(toUtf8Bytes(JSON.stringify(input))) as Bytes32,
  };
}
