import { AbiCoder, keccak256 } from "ethers";

import {
  Outcome,
  Side,
  type Bytes32,
  type CredibilityProfile,
  type Hex,
  type MarketState,
  type PactSpec,
  type PredType,
  type Verdict,
} from "../shared/schemas.js";

const abi = AbiCoder.defaultAbiCoder();
const zeroHash = `0x${"0".repeat(64)}` as Bytes32;

export interface CreatePactInput {
  subject: Hex;
  predType: PredType;
  paramsBlob: Hex;
  deadline: number;
  bond: bigint;
}

export interface TakePositionInput {
  pactId: Bytes32;
  side: Side;
  amount: bigint;
  trader?: Hex;
}

export interface Settlement {
  pactId: Bytes32;
  outcome: Outcome;
  evidenceHash: Bytes32;
  difficulty: number;
  subject: Hex;
}

export interface LedgerPact extends PactSpec {
  predType: PredType;
  paramsBlob: Hex;
  outcome: Outcome;
  commitPool: bigint;
  skepticPool: bigint;
}

export type LedgerEventName = "PactCreated" | "PositionTaken" | "Settled";
export type LedgerEventPayload = LedgerPact | Settlement | Record<string, unknown>;
export type LedgerEventHandler = (payload: LedgerEventPayload) => void;

export class LocalLedgerMock {
  private readonly pacts = new Map<Bytes32, LedgerPact>();
  private readonly profiles = new Map<Hex, CredibilityProfile>();
  private readonly handlers = new Map<LedgerEventName, Set<LedgerEventHandler>>();
  private nonce = 0n;

  async createPact(input: CreatePactInput): Promise<LedgerPact> {
    const predicateHash = hashPredicate(input.predType, input.paramsBlob);
    const pactId = this.nextPactId(input.subject, predicateHash, input.deadline);
    const pact: LedgerPact = {
      pactId,
      subject: input.subject,
      predicateHash,
      deadline: input.deadline,
      bond: input.bond,
      predType: input.predType,
      paramsBlob: input.paramsBlob,
      outcome: Outcome.Pending,
      commitPool: 0n,
      skepticPool: 0n,
    };

    this.pacts.set(pactId, pact);
    this.ensureProfile(input.subject);
    this.emit("PactCreated", pact);
    return pact;
  }

  async takePosition(input: TakePositionInput): Promise<MarketState> {
    if (input.amount <= 0n) {
      throw new Error("Position amount must be positive.");
    }

    const pact = this.requirePact(input.pactId);
    if (pact.outcome !== Outcome.Pending) {
      throw new Error("Cannot take a position after settlement.");
    }

    if (input.side === Side.Commit) {
      pact.commitPool += input.amount;
    } else {
      pact.skepticPool += input.amount;
    }

    const state = this.marketState(pact);
    this.emit("PositionTaken", {
      pactId: input.pactId,
      side: input.side,
      amount: input.amount,
      trader: input.trader,
      impliedBreachProb: state.impliedBreachProb,
    });
    return state;
  }

  async submitVerdict(verdict: Verdict): Promise<Settlement> {
    const pact = this.requirePact(verdict.pactId);
    if (pact.outcome !== Outcome.Pending) {
      throw new Error("Pact has already been settled.");
    }
    if (verdict.outcome === Outcome.Pending) {
      throw new Error("Verdict outcome cannot be pending.");
    }

    const difficulty = this.impliedBreachProbSync(pact);
    pact.outcome = verdict.outcome;
    const profile = this.ensureProfile(pact.subject);
    profile.totalBond += pact.bond;

    if (verdict.outcome === Outcome.Kept) {
      profile.kept += 1;
      profile.score += scaleBondByProbability(pact.bond, difficulty);
    } else {
      profile.broken += 1;
      profile.permanentStain = true;
      profile.score -= scaleBondByProbability(pact.bond, Math.max(difficulty, 0.25));
    }

    const settlement: Settlement = {
      pactId: pact.pactId,
      outcome: verdict.outcome,
      evidenceHash: verdict.evidenceHash,
      difficulty,
      subject: pact.subject,
    };
    this.emit("Settled", settlement);
    return settlement;
  }

  async impliedBreachProb(pactId: Bytes32): Promise<number> {
    return this.impliedBreachProbSync(this.requirePact(pactId));
  }

  async getPact(pactId: Bytes32): Promise<LedgerPact> {
    return { ...this.requirePact(pactId) };
  }

  async getProfile(subject: Hex): Promise<CredibilityProfile> {
    return { ...this.ensureProfile(subject) };
  }

  subscribe(eventName: LedgerEventName, handler: LedgerEventHandler): () => void {
    const handlers = this.handlers.get(eventName) ?? new Set<LedgerEventHandler>();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);

    return () => {
      handlers.delete(handler);
    };
  }

  setProfile(profile: CredibilityProfile): void {
    this.profiles.set(profile.subject, { ...profile });
  }

  private nextPactId(subject: Hex, predicateHash: Bytes32, deadline: number): Bytes32 {
    this.nonce += 1n;
    return keccak256(
      abi.encode(["address", "bytes32", "uint256", "uint256"], [subject, predicateHash, deadline, this.nonce]),
    ) as Bytes32;
  }

  private requirePact(pactId: Bytes32): LedgerPact {
    const pact = this.pacts.get(pactId);
    if (!pact) {
      throw new Error(`Unknown pact: ${pactId}`);
    }
    return pact;
  }

  private ensureProfile(subject: Hex): CredibilityProfile {
    const existing = this.profiles.get(subject);
    if (existing) {
      return existing;
    }

    const profile: CredibilityProfile = {
      subject,
      score: 0n,
      kept: 0,
      broken: 0,
      totalBond: 0n,
      permanentStain: false,
    };
    this.profiles.set(subject, profile);
    return profile;
  }

  private marketState(pact: LedgerPact): MarketState {
    return {
      pactId: pact.pactId,
      commitPool: pact.commitPool,
      skepticPool: pact.skepticPool,
      impliedBreachProb: this.impliedBreachProbSync(pact),
      deadline: pact.deadline,
    };
  }

  private impliedBreachProbSync(pact: LedgerPact): number {
    const total = pact.commitPool + pact.skepticPool;
    if (total === 0n) {
      return 0.5;
    }

    return Number(pact.skepticPool) / Number(total);
  }

  private emit(eventName: LedgerEventName, payload: LedgerEventPayload): void {
    for (const handler of this.handlers.get(eventName) ?? []) {
      handler(payload);
    }
  }
}

export function hashPredicate(predType: PredType, paramsBlob: Hex): Bytes32 {
  if (paramsBlob === "0x") {
    return zeroHash;
  }

  return keccak256(abi.encode(["uint8", "bytes"], [predType, paramsBlob])) as Bytes32;
}

function scaleBondByProbability(bond: bigint, probability: number): bigint {
  const bps = BigInt(Math.round(Math.max(0, Math.min(1, probability)) * 10_000));
  return (bond * bps) / 10_000n;
}
