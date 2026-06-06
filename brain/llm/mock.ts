import { getAddress, keccak256, toUtf8Bytes } from "ethers";

import type { Tier } from "../shared/schemas.js";

export interface LlmRequest {
  task: "compile-predicate" | "verify-habit" | "verify-policy";
  goal: string;
  tier: Tier;
  evidence?: unknown;
}

export interface BrainLlm {
  completeStructured(request: LlmRequest): Promise<Record<string, unknown>>;
}

export function createMockLlm(): BrainLlm {
  return {
    async completeStructured(request) {
      if (request.task === "compile-predicate") {
        return compilePredicateResponse(request.goal, request.tier);
      }

      if (request.task === "verify-policy") {
        return {
          outcomeHint: "kept",
          confidence: 0.72,
          citations: ["mock://policy/source/primary", "mock://policy/source/secondary"],
        };
      }

      return {
        outcomeHint: "kept",
        confidence: 0.8,
        reason: "mock evidence is internally consistent",
      };
    },
  };
}

export function deterministicAddress(seed: string): `0x${string}` {
  const hash = keccak256(toUtf8Bytes(seed));
  const rawAddress = `0x${hash.slice(-40)}`;
  return getAddress(rawAddress).toLowerCase() as `0x${string}`;
}

function compilePredicateResponse(goal: string, tier: Tier): Record<string, unknown> {
  if (tier === "L2") {
    return {
      kind: "contract_deployed",
      target: deterministicAddress(`onchain-milestone:${goal}`),
      rationale: "L2 delivery goals are compiled into a deterministic deployment milestone.",
    };
  }

  if (tier === "L1") {
    return {
      kind: "habit_checkin",
      requiredDays: inferRequiredDays(goal),
      cadence: "daily",
      rationale: "L1 habit goals are verified from recurring check-in evidence.",
    };
  }

  return {
    kind: "policy_metric",
    metric: goal,
    sourcePolicy: "multi_source_public_records",
    rationale: "L3 public commitments require cited multi-source verification.",
  };
}

function inferRequiredDays(goal: string): number {
  const match = goal.match(/(\d+)\s*天/);
  return match ? Number(match[1]) : 30;
}
