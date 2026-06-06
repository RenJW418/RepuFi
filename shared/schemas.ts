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
