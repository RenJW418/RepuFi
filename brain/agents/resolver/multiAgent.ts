import { keccak256, toUtf8Bytes } from "ethers";

import type { BrainLlm } from "../../llm/mock.js";
import { Outcome, type Bytes32 } from "../../shared/schemas.js";

export interface AgentVerdict {
  agentId: number;
  outcome: Outcome;
  confidence: number;
  reasoning: string;
}

export interface MultiAgentResult {
  pactId: Bytes32;
  verdicts: AgentVerdict[];
  majorityOutcome: Outcome;
  agreement: number; // fraction in [0, 1]
  evidenceHash: Bytes32;
  unanimous: boolean;
}

const AGENT_COUNT = 3;

export async function runMultiAgentVerdict(input: {
  pactId: Bytes32;
  goal: string;
  evidence: Record<string, unknown>;
  llm: BrainLlm;
}): Promise<MultiAgentResult> {
  const verdicts: AgentVerdict[] = await Promise.all(
    Array.from({ length: AGENT_COUNT }, async (_, i) => {
      const response = await input.llm.completeStructured({
        task: "multi-agent-verdict",
        goal: input.goal,
        tier: "L2",
        evidence: input.evidence,
        agentId: i,
      });

      const outcomeHint = String(response.outcomeHint ?? "kept");
      const outcome =
        outcomeHint === "breached" ? Outcome.Breached : Outcome.Kept;

      return {
        agentId: i,
        outcome,
        confidence: Number(response.confidence ?? 0.7),
        reasoning: String(response.reasoning ?? `Agent ${i} verdict`),
      };
    }),
  );

  const keptCount = verdicts.filter((v) => v.outcome === Outcome.Kept).length;
  const breachedCount = verdicts.length - keptCount;
  const majorityOutcome =
    keptCount >= breachedCount ? Outcome.Kept : Outcome.Breached;
  const agreement =
    Math.max(keptCount, breachedCount) / verdicts.length;

  const evidenceHash = keccak256(
    toUtf8Bytes(JSON.stringify({ pactId: input.pactId, verdicts })),
  ) as Bytes32;

  return {
    pactId: input.pactId,
    verdicts,
    majorityOutcome,
    agreement,
    evidenceHash,
    unanimous: agreement === 1,
  };
}
