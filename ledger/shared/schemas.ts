export enum Side {
  Commit = 0,
  Skeptic = 1
}

export enum Outcome {
  Pending = 0,
  Kept = 1,
  Breached = 2
}

export enum PredType {
  ONCHAIN_MILESTONE = 1,
  WHITELIST_OUTFLOW = 2,
  HABIT = 3,
  POLICY = 4
}

export type Hex = `0x${string}`;
export type Bytes32 = `0x${string}`;
export type Tier = "L1" | "L2" | "L3";

export interface PactSpec {
  pactId: `0x${string}`;
  subject: `0x${string}`;
  predicateHash: `0x${string}`;
  deadline: number;
  bond: bigint;
}

export interface Position {
  pactId: `0x${string}`;
  side: Side;
  account: `0x${string}`;
  amount: bigint;
}

export interface Verdict {
  pactId: `0x${string}`;
  outcome: Outcome;
  evidenceHash: `0x${string}`;
  verifierSig: `0x${string}`;
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
