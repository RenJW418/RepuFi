import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";

export interface OnchainMilestoneInput {
  pactId: Bytes32;
  target: Hex;
  chainState: {
    deployedAddresses: Hex[];
  };
}

export interface VerificationReceipt {
  pactId: Bytes32;
  outcome: Outcome.Kept | Outcome.Breached;
  evidenceHash: Bytes32;
  evidence: Record<string, unknown>;
}

export async function verifyOnchainMilestone(input: OnchainMilestoneInput): Promise<VerificationReceipt> {
  const target = input.target.toLowerCase() as Hex;
  const deployed = input.chainState.deployedAddresses.map((address) => address.toLowerCase()).includes(target);
  const evidence = {
    verifier: "onchain_milestone",
    target,
    deployed,
  };

  return {
    pactId: input.pactId,
    outcome: deployed ? Outcome.Kept : Outcome.Breached,
    evidenceHash: keccak256(toUtf8Bytes(JSON.stringify(evidence))) as Bytes32,
    evidence,
  };
}
