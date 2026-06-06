import type { BrainLlm } from "../../llm/mock.js";
import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";
import { proposeOutcomeViaUma, resolveDvm } from "./uma.js";
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
  // UMA bond accounting
  bondSlashedTo?: Hex;
}

export interface ResolveInput {
  pactId: Bytes32;
  goal: string;
  subject: Hex;
  participants: Hex[];
  evidence: Record<string, unknown>;
  llm: BrainLlm;
  tokenHolders: TokenHolder[];
  primaryOutcome?: Outcome;
  simulateUmaDispute?: boolean;
  umaProposerAddress?: Hex;
}

/**
 * Full resolution pipeline (mirrors Polymarket UMA OO):
 *
 * 1. Deterministic verifier produces primaryOutcome (onchain/habit/policy).
 * 2. Multi-agent panel independently verifies (3 agents, majority vote).
 * 3. UMA Optimistic Oracle: proposer posts primaryOutcome + bond.
 *    a. No dispute within liveness window → settled, agents agree → done.
 *    b. Disputer challenges (when agents disagree with UMA) → disputed.
 *    c. DVM/human-review resolves disputed case → bond slashed.
 * 4. Interest-isolated token-holder vote is the final backstop.
 */
export async function resolveOutcome(input: ResolveInput): Promise<ResolutionResult> {
  const proposer = input.umaProposerAddress ?? ("0x0000000000000000000000000000000000000001" as Hex);
  const hasPrimary = input.primaryOutcome !== undefined;
  const primaryOutcome = input.primaryOutcome ?? Outcome.Kept;

  // Step 1: Multi-agent independent cross-check
  const multiResult = await runMultiAgentVerdict({
    pactId: input.pactId,
    goal: input.goal,
    evidence: input.evidence,
    llm: input.llm,
  });

  // Step 2: UMA OO — propose primary outcome
  // If agents disagree with primary, simulate a disputer challenging
  const agentsDisagree = hasPrimary && multiResult.majorityOutcome !== primaryOutcome;
  const umaResult = await proposeOutcomeViaUma({
    pactId: input.pactId,
    proposedOutcome: primaryOutcome,
    proposer,
    forcedDispute: input.simulateUmaDispute || agentsDisagree,
    disputeReason: agentsDisagree
      ? `Multi-agent majority (${Math.round(multiResult.agreement * 100)}%) disagrees with proposer`
      : undefined,
  });

  // Step 3a: UMA undisputed + agents agree → fast settle
  if (!umaResult.disputed) {
    return {
      pactId: input.pactId,
      outcome: primaryOutcome,
      evidenceHash: umaResult.evidenceHash,
      source: multiResult.unanimous ? "multi_agent_unanimous" : "uma_oracle",
      conflict: false,
      detail: multiResult.unanimous
        ? `全体 Agent 一致裁决 + UMA Oracle 无争议结算。Agreement=${Math.round(multiResult.agreement * 100)}%`
        : `UMA Oracle 无争议结算，多 Agent 多数支持。Agreement=${Math.round(multiResult.agreement * 100)}%`,
    };
  }

  // Step 3b/c: Disputed → DVM = human review (interest-isolated token-holder vote)
  const humanResult = runHumanReview({
    pactId: input.pactId,
    subject: input.subject,
    participants: input.participants,
    tokenHolders: input.tokenHolders,
  });

  // DVM resolves the dispute; loser bond slashed
  const dvmResolved = resolveDvm(umaResult.proposal, humanResult.outcome);

  const source: ResolutionSource = agentsDisagree
    ? "multi_agent_majority_human_review"
    : "uma_disputed_human_review";

  const agentNote = agentsDisagree
    ? `多 Agent 与一级裁判结果不一致（Agent=${multiResult.majorityOutcome === Outcome.Kept ? "守约" : "违约"}，UMA=${primaryOutcome === Outcome.Kept ? "守约" : "违约"}）→ `
    : "UMA 提案遭到争议 → ";

  return {
    pactId: input.pactId,
    outcome: humanResult.outcome,
    evidenceHash: humanResult.evidenceHash,
    source,
    conflict: true,
    bondSlashedTo: dvmResolved.bondSlashedTo,
    detail:
      agentNote +
      `代币持有者人工复核（DVM）。有效选票=${humanResult.eligibleVoters}，排除利益相关方=${humanResult.excludedAddresses.length}，法定人数=${humanResult.quorumReached}，` +
      `Bond 归还至 ${dvmResolved.bondSlashedTo?.slice(0, 10)}…`,
  };
}
