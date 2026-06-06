import { AbiCoder } from "ethers";

import { createMockLlm, type BrainLlm } from "../../llm/mock.js";
import { PredType, type Hex, type Tier } from "../../shared/schemas.js";
import type { PredicateSpec } from "./types.js";

const abi = AbiCoder.defaultAbiCoder();

export async function compilePredicate(input: {
  goal: string;
  tier: Tier;
  llm?: BrainLlm;
}): Promise<PredicateSpec> {
  const llm = input.llm ?? createMockLlm();
  const response = await llm.completeStructured({
    task: "compile-predicate",
    goal: input.goal,
    tier: input.tier,
  });

  if (input.tier === "L2") {
    const target = requireHexString(response.target, "target");
    return {
      goal: input.goal,
      tier: input.tier,
      predType: PredType.ONCHAIN_MILESTONE,
      params: {
        kind: "contract_deployed",
        target,
      },
      paramsBlob: abi.encode(["address"], [target]) as Hex,
      rationale: String(response.rationale ?? "compiled as an onchain milestone"),
    };
  }

  if (input.tier === "L1") {
    const requiredDays = Number(response.requiredDays ?? 30);
    return {
      goal: input.goal,
      tier: input.tier,
      predType: PredType.HABIT,
      params: {
        kind: "habit_checkin",
        requiredDays,
        cadence: "daily",
      },
      paramsBlob: abi.encode(["uint16", "string"], [requiredDays, "daily"]) as Hex,
      rationale: String(response.rationale ?? "compiled as a habit check-in predicate"),
    };
  }

  return {
    goal: input.goal,
    tier: input.tier,
    predType: PredType.POLICY,
    params: {
      kind: "policy_metric",
      metric: String(response.metric ?? input.goal),
      sourcePolicy: String(response.sourcePolicy ?? "multi_source_public_records"),
    },
    paramsBlob: abi.encode(
      ["string", "string"],
      [String(response.metric ?? input.goal), String(response.sourcePolicy ?? "multi_source_public_records")],
    ) as Hex,
    rationale: String(response.rationale ?? "compiled as a policy metric predicate"),
  };
}

function requireHexString(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`LLM response field ${field} must be a hex string.`);
  }

  return value.toLowerCase() as Hex;
}
