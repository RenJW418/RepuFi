export enum Side {
  Commit = 0,
  Skeptic = 1,
}

export enum Outcome {
  Pending = 0,
  Kept = 1,
  Breached = 2,
}

export enum PredType {
  ONCHAIN_MILESTONE = 1,
  WHITELIST_OUTFLOW = 2,
  HABIT = 3,
  POLICY = 4,
}

export type Hex = `0x${string}`;
export type Bytes32 = `0x${string}`;
export type Tier = "L1" | "L2" | "L3";

export interface PactSpec {
  pactId: Bytes32;
  subject: Hex;
  predicateHash: Bytes32;
  deadline: number;
  bond: bigint;
}

export interface Verdict {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  verifierSig: Hex;
}

export interface Position {
  pactId: Bytes32;
  side: Side;
  account: Hex;
  amount: bigint;
}

export interface CredibilityProfile {
  subject: Hex;
  score: bigint;
  kept: number;
  broken: number;
  totalBond: bigint;
  permanentStain: boolean;
}

export interface MarketState {
  pactId: Bytes32;
  commitPool: bigint;
  skepticPool: bigint;
  impliedBreachProb: number;
  deadline: number;
}
