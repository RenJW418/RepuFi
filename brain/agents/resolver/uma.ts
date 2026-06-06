import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";

export type UmaProposalState = "proposed" | "disputed" | "settled";

export interface UmaProposal {
  pactId: Bytes32;
  proposedOutcome: Outcome;
  evidenceHash: Bytes32;
  proposer: Hex;
  state: UmaProposalState;
  disputeReason?: string;
}

export interface UmaResolutionResult {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  source: "uma_oracle" | "uma_disputed";
  disputed: boolean;
  proposal: UmaProposal;
}

// Mock UMA oracle: propose outcome, allow dispute, settle after liveness window
export async function proposeOutcomeViaUma(input: {
  pactId: Bytes32;
  proposedOutcome: Outcome;
  proposer: Hex;
  forcedDispute?: boolean;
}): Promise<UmaResolutionResult> {
  const evidenceHash = keccak256(
    toUtf8Bytes(
      JSON.stringify({ pactId: input.pactId, outcome: input.proposedOutcome, source: "uma" }),
    ),
  ) as Bytes32;

  const proposal: UmaProposal = {
    pactId: input.pactId,
    proposedOutcome: input.proposedOutcome,
    evidenceHash,
    proposer: input.proposer,
    state: input.forcedDispute ? "disputed" : "proposed",
    disputeReason: input.forcedDispute ? "Disputer challenges the proposed outcome" : undefined,
  };

  if (input.forcedDispute) {
    // Disputed → falls back to DVM / token holder vote (human review)
    return {
      pactId: input.pactId,
      outcome: input.proposedOutcome,
      evidenceHash,
      source: "uma_disputed",
      disputed: true,
      proposal: { ...proposal, state: "disputed" },
    };
  }

  // Liveness window passed with no dispute → settled
  return {
    pactId: input.pactId,
    outcome: input.proposedOutcome,
    evidenceHash,
    source: "uma_oracle",
    disputed: false,
    proposal: { ...proposal, state: "settled" },
  };
}
