/**
 * UMA Optimistic Oracle (OO) — inspired by Polymarket / UMA v2
 *
 * Flow (mirrors real UMA OO):
 *   1. Proposer posts outcome + bonds proposerBond → state = "proposed"
 *   2. Liveness window runs (LIVENESS_SECONDS). Anyone can challengeProposal.
 *   3. No challenge → automatically settles (settled).
 *   4. Challenge posted: disputer bonds disputerBond → state = "disputed"
 *   5. Disputed case escalates to DVM / token-holder vote (humanReview).
 *   6. DVM resolves → loser bond slashed to winner.
 *
 * In our mock the "liveness window" is simulated synchronously. Real
 * integration would watch block timestamps.
 */
import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";

// Demo liveness: 5 min in real deployment, 0 for instant mock
export const LIVENESS_SECONDS = 0;
// Bonds in wei (mock values)
export const PROPOSER_BOND = 100_000_000_000_000_000n; // 0.1 ETH
export const DISPUTER_BOND = 100_000_000_000_000_000n; // 0.1 ETH

export type UmaProposalState =
  | "proposed"    // waiting for liveness window
  | "settled"     // liveness passed, no dispute → finalized
  | "disputed"    // someone challenged → goes to DVM
  | "dvm_resolved"; // DVM/human review concluded

export interface UmaProposal {
  pactId: Bytes32;
  proposedOutcome: Outcome;
  evidenceHash: Bytes32;
  proposer: Hex;
  proposerBond: bigint;
  proposedAt: number; // unix seconds
  livenessEndsAt: number;
  state: UmaProposalState;
  // Set when disputed
  disputer?: Hex;
  disputerBond?: bigint;
  disputedAt?: number;
  disputeReason?: string;
  // Set after DVM
  dvmOutcome?: Outcome;
}

export interface UmaResolutionResult {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  source: "uma_oracle" | "uma_disputed";
  disputed: boolean;
  bondSlashedTo?: Hex; // address that wins the forfeited bond
  proposal: UmaProposal;
}

/**
 * Post an optimistic proposal. If forcedDispute=true, simulates a disputer
 * immediately challenging in the liveness window (used in demo/conflict paths).
 */
export async function proposeOutcomeViaUma(input: {
  pactId: Bytes32;
  proposedOutcome: Outcome;
  proposer: Hex;
  forcedDispute?: boolean;
  disputer?: Hex;
  disputeReason?: string;
}): Promise<UmaResolutionResult> {
  const now = Math.floor(Date.now() / 1000);
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
    proposerBond: PROPOSER_BOND,
    proposedAt: now,
    livenessEndsAt: now + LIVENESS_SECONDS,
    state: "proposed",
  };

  if (input.forcedDispute) {
    const disputer = input.disputer ?? ("0xd15put3r000000000000000000000000000000d1" as Hex);
    Object.assign(proposal, {
      state: "disputed" as UmaProposalState,
      disputer,
      disputerBond: DISPUTER_BOND,
      disputedAt: now,
      disputeReason: input.disputeReason ?? "Disputer challenges the proposed outcome",
    });
    return {
      pactId: input.pactId,
      outcome: input.proposedOutcome,
      evidenceHash,
      source: "uma_disputed",
      disputed: true,
      // Bond goes to whichever side DVM agrees with (resolved later)
      proposal,
    };
  }

  // Liveness passed with no dispute → settled
  proposal.state = "settled";
  return {
    pactId: input.pactId,
    outcome: input.proposedOutcome,
    evidenceHash,
    source: "uma_oracle",
    disputed: false,
    bondSlashedTo: undefined,
    proposal,
  };
}

/**
 * Simulate a disputer challenging a proposal during liveness window.
 * Returns the updated proposal (state = "disputed").
 */
export function challengeProposal(
  proposal: UmaProposal,
  disputer: Hex,
  reason: string,
): UmaProposal {
  if (proposal.state !== "proposed") {
    throw new Error(
      `Cannot challenge proposal in state "${proposal.state}". Must be "proposed".`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (now > proposal.livenessEndsAt && LIVENESS_SECONDS > 0) {
    throw new Error("Liveness window has closed; proposal is already settled.");
  }
  return {
    ...proposal,
    state: "disputed",
    disputer,
    disputerBond: DISPUTER_BOND,
    disputedAt: now,
    disputeReason: reason,
  };
}

/**
 * DVM resolves the dispute. Winner keeps their bond + gets loser's bond.
 * In mock: dvmOutcome = humanReview outcome.
 */
export function resolveDvm(
  proposal: UmaProposal,
  dvmOutcome: Outcome,
): UmaProposal & { bondSlashedTo: Hex } {
  if (proposal.state !== "disputed") {
    throw new Error(`Cannot resolve DVM for proposal in state "${proposal.state}".`);
  }
  // If DVM agrees with proposer → disputer's bond slashed to proposer
  // If DVM disagrees → proposer's bond slashed to disputer
  const bondSlashedTo =
    dvmOutcome === proposal.proposedOutcome
      ? proposal.proposer
      : (proposal.disputer ?? proposal.proposer);

  return {
    ...proposal,
    state: "dvm_resolved",
    dvmOutcome,
    bondSlashedTo,
  };
}
