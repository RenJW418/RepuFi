import {
  LocalLedgerMock,
  type CreatePactInput,
  type LedgerEventHandler,
  type LedgerEventName,
  type LedgerPact,
  type Settlement,
  type TakePositionInput,
} from "../../mocks/LocalLedgerMock.js";
import type { Bytes32, CredibilityProfile, MarketState, Verdict } from "../../shared/schemas.js";
import { RepuFiLedgerClient } from "./repuFiLedger.js";

export interface LedgerClient {
  createPact(input: CreatePactInput): Promise<LedgerPact>;
  takePosition(input: TakePositionInput): Promise<MarketState>;
  submitVerdict(verdict: Verdict): Promise<Settlement>;
  impliedBreachProb(pactId: Bytes32): Promise<number>;
  getPact(pactId: Bytes32): Promise<LedgerPact>;
  getProfile(subject: `0x${string}`): Promise<CredibilityProfile>;
  subscribe(eventName: LedgerEventName, handler: LedgerEventHandler): () => void;
}

export function createLedger(options: { mode?: "mock" | "local" | "testnet" } = {}): LedgerClient {
  const mode = options.mode ?? process.env.MODE ?? "mock";
  if (mode === "mock") {
    return new LocalLedgerMock();
  }

  return new RepuFiLedgerClient();
}
