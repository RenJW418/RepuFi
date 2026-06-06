import { keccak256, toUtf8Bytes } from "ethers";

import { Outcome, type Bytes32, type Hex } from "../../shared/schemas.js";

export interface TokenHolder {
  address: Hex;
  balance: bigint;
}

export interface HumanReviewInput {
  pactId: Bytes32;
  subject: Hex;
  participants: Hex[]; // pact participants — excluded from voting
  tokenHolders: TokenHolder[];
  // simulated votes: address → outcome
  simulatedVotes?: Map<Hex, Outcome>;
}

export interface HumanReviewResult {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  totalVoters: number;
  eligibleVoters: number;
  votesKept: bigint;
  votesBreached: bigint;
  excludedAddresses: Hex[];
  quorumReached: boolean;
}

const QUORUM_FRACTION = 0.1; // 10% of eligible token weight must vote

export function runHumanReview(input: HumanReviewInput): HumanReviewResult {
  // Interest isolation: subject + participants cannot vote
  const excluded = new Set<string>([
    input.subject.toLowerCase(),
    ...input.participants.map((a) => a.toLowerCase()),
  ]);

  const eligible = input.tokenHolders.filter(
    (h) => !excluded.has(h.address.toLowerCase()),
  );

  const totalWeight = eligible.reduce((s, h) => s + h.balance, 0n);
  const quorumThreshold =
    totalWeight === 0n
      ? 1n // impossible to reach when no eligible voters
      : (totalWeight * BigInt(Math.floor(QUORUM_FRACTION * 1000))) / 1000n;

  const votes = input.simulatedVotes ?? buildDefaultVotes(eligible);

  let votesKept = 0n;
  let votesBreached = 0n;

  for (const holder of eligible) {
    const vote = votes.get(holder.address.toLowerCase() as Hex);
    if (vote === undefined) continue;
    if (vote === Outcome.Kept) {
      votesKept += holder.balance;
    } else if (vote === Outcome.Breached) {
      votesBreached += holder.balance;
    }
  }

  const totalVoted = votesKept + votesBreached;
  const quorumReached = totalVoted >= quorumThreshold;

  // If quorum not reached, default to Kept (benefit of the doubt)
  const outcome = !quorumReached
    ? Outcome.Kept
    : votesKept >= votesBreached
      ? Outcome.Kept
      : Outcome.Breached;

  const evidenceHash = keccak256(
    toUtf8Bytes(
      JSON.stringify({ pactId: input.pactId, votesKept: votesKept.toString(), votesBreached: votesBreached.toString() }),
    ),
  ) as Bytes32;

  return {
    pactId: input.pactId,
    outcome,
    evidenceHash,
    totalVoters: input.tokenHolders.length,
    eligibleVoters: eligible.length,
    votesKept,
    votesBreached,
    excludedAddresses: [...excluded].map((a) => a as Hex),
    quorumReached,
  };
}

function buildDefaultVotes(holders: TokenHolder[]): Map<Hex, Outcome> {
  const map = new Map<Hex, Outcome>();
  holders.forEach((h, i) => {
    map.set(h.address.toLowerCase() as Hex, i % 3 === 0 ? Outcome.Breached : Outcome.Kept);
  });
  return map;
}
