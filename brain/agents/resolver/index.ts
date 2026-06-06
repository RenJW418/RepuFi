import type { BrainLlm } from "../../llm/mock.js";
import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";
import { proposeOutcomeViaUma } from "./uma.js";
import { runMultiAgentVerdict } from "./multiAgent.js";
import { runHumanReview, type TokenHolder } from "./humanReview.js";

export type ResolutionSource =
  | "uma_oracle"
  | "uma_disputed_human_review"
  | "multi_agent_unanimous"
  | "multi_agent_majority_human_review";

export interface ResolutionResult {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  source: ResolutionSource;
  conflict: boolean;
  detail: string;
}

export interface ResolveInput {
  pactId: Bytes32;
  goal: string;
  subject: Hex;
  participants: Hex[];
  evidence: Record<string, unknown>;
  llm: BrainLlm;
  tokenHolders: TokenHolder[];
  // Primary outcome from deterministic verifier (onchain/habit/policy)
  // If provided, UMA proposes this; multi-agent independently cross-checks.
  primaryOutcome?: Outcome;
  // For UMA mock: whether to simulate a dispute
  simulateUmaDispute?: boolean;
  umaProposerAddress?: Hex;
}

// Full resolution pipeline:
// 1. Multi-agent parallel verdict
// 2. UMA oracle proposal
// 3. If multi-agent unanimous AND UMA agrees → settle immediately
// 4. If multi-agent disagrees with UMA → escalate to human review (token holder vote)
// 5. If UMA disputed → human review
export async function resolveOutcome(input: ResolveInput): Promise<ResolutionResult> {
  const proposer = input.umaProposerAddress ?? ("0x0000000000000000000000000000000000000001" as Hex);

  // Step 1: UMA proposes the primary (deterministic) outcome.
  // If no primaryOutcome provided, fall back to multi-agent first.
  const hasPrimary = input.primaryOutcome !== undefined;
  const primaryOutcome = input.primaryOutcome ?? Outcome.Kept;

  // Step 2: multi-agent independently cross-checks the evidence
  const multiResult = await runMultiAgentVerdict({
    pactId: input.pactId,
    goal: input.goal,
    evidence: input.evidence,
    llm: input.llm,
  });

  // Step 3: UMA oracle proposes the primary outcome
  const umaResult = await proposeOutcomeViaUma({
    pactId: input.pactId,
    proposedOutcome: primaryOutcome,
    proposer,
    forcedDispute: input.simulateUmaDispute,
  });

  // Step 4: UMA disputed → escalate to human review immediately
  if (umaResult.disputed) {
    const humanResult = runHumanReview({
      pactId: input.pactId,
      subject: input.subject,
      participants: input.participants,
      tokenHolders: input.tokenHolders,
    });
    return {
      pactId: input.pactId,
      outcome: humanResult.outcome,
      evidenceHash: humanResult.evidenceHash,
      source: "uma_disputed_human_review",
      conflict: true,
      detail: `UMA 提案遭到争议，升级到代币持有者人工复核。有效选票=${humanResult.eligibleVoters}，排除利益相关方=${humanResult.excludedAddresses.length}，法定人数=${humanResult.quorumReached}`,
    };
  }

  // Step 5: Multi-agent agrees with primary outcome (or no primary) → settle
  const agentAgreesPrimary = !hasPrimary || multiResult.majorityOutcome === primaryOutcome;
  if (agentAgreesPrimary) {
    return {
      pactId: input.pactId,
      outcome: primaryOutcome,
      evidenceHash: umaResult.evidenceHash,
      source: multiResult.unanimous ? "multi_agent_unanimous" : "uma_oracle",
      conflict: false,
      detail: multiResult.unanimous
        ? `全体 Agent 一致裁决 + UMA Oracle 确认，无争议直接结算。Agreement=${Math.round(multiResult.agreement * 100)}%`
        : `多 Agent 多数裁决与一级裁判/UMA Oracle 一致。Agreement=${Math.round(multiResult.agreement * 100)}%`,
    };
  }

  // Step 6: Multi-agent disagrees with primary outcome → escalate to human review
  const humanResult = runHumanReview({
    pactId: input.pactId,
    subject: input.subject,
    participants: input.participants,
    tokenHolders: input.tokenHolders,
  });

  return {
    pactId: input.pactId,
    outcome: humanResult.outcome,
    evidenceHash: humanResult.evidenceHash,
    source: "multi_agent_majority_human_review",
    conflict: true,
    detail: `多 Agent 与一级裁判结果不一致（Agent=${multiResult.majorityOutcome === Outcome.Kept ? "守约" : "违约"}，一级裁判=${primaryOutcome === Outcome.Kept ? "守约" : "违约"}），升级代币持有者投票。法定人数=${humanResult.quorumReached}`,
  };
}
