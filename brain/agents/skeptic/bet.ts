import type { LedgerClient } from "../base/ledger.js";
import { Side, type Bytes32 } from "../../shared/schemas.js";

export interface BetDecisionInput {
  ledger: LedgerClient;
  pactId: Bytes32;
  modelBreachProbability: number;
  edge: number;
  amount: bigint;
}

export interface BetDecision {
  placed: boolean;
  side?: Side;
  amount: bigint;
  marketBreachProbability: number;
  edge: number;
}

export async function decideAndPlaceBet(input: BetDecisionInput): Promise<BetDecision> {
  const marketBreachProbability = await input.ledger.impliedBreachProb(input.pactId);
  const edge = input.modelBreachProbability - marketBreachProbability;

  if (Math.abs(edge) <= input.edge) {
    return {
      placed: false,
      amount: 0n,
      marketBreachProbability,
      edge,
    };
  }

  const side = edge > 0 ? Side.Skeptic : Side.Commit;
  await input.ledger.takePosition({
    pactId: input.pactId,
    side,
    amount: input.amount,
  });

  return {
    placed: true,
    side,
    amount: input.amount,
    marketBreachProbability,
    edge,
  };
}
