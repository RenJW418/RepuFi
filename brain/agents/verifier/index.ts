import type { PredicateSpec } from "../predicate/types.js";
import { verifyHabitEvidence } from "./habit.js";
import { verifyOnchainMilestone } from "./onchain.js";
import { verifyPolicyEvidence } from "./policy.js";
import { type Bytes32, type Hex } from "../../shared/schemas.js";

export async function verifyPredicate(input: {
  pactId: Bytes32;
  predicate: PredicateSpec;
  evidence: Record<string, unknown>;
}) {
  if (input.predicate.tier === "L2" && input.predicate.params.kind === "contract_deployed") {
    return verifyOnchainMilestone({
      pactId: input.pactId,
      target: input.predicate.params.target,
      chainState: {
        deployedAddresses: (input.evidence.deployedAddresses ?? []) as Hex[],
      },
    });
  }

  if (input.predicate.tier === "L1" && input.predicate.params.kind === "habit_checkin") {
    return verifyHabitEvidence({
      pactId: input.pactId,
      completedCheckins: Number(input.evidence.completedCheckins ?? 0),
      requiredCheckins: input.predicate.params.requiredDays,
    });
  }

  return verifyPolicyEvidence({
    pactId: input.pactId,
    positiveSources: (input.evidence.positiveSources ?? []) as string[],
    negativeSources: (input.evidence.negativeSources ?? []) as string[],
  });
}
