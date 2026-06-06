import { createLlmClient } from "../../llm/client.js";
import type { BrainLlm } from "../../llm/mock.js";
import { createLedger, type LedgerClient } from "./ledger.js";

export interface BrainRuntime {
  ledger: LedgerClient;
  llm: BrainLlm;
}

export function createBrainRuntime(options: {
  mode?: "mock" | "local" | "testnet";
  llm?: BrainLlm;
} = {}): BrainRuntime {
  return {
    ledger: createLedger({ mode: options.mode ?? "mock" }),
    llm: options.llm ?? createLlmClient(),
  };
}
