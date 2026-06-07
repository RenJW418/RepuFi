import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type ContractTransactionResponse,
  type InterfaceAbi,
  type Log,
  type LogDescription,
} from "ethers";

import {
  Outcome,
  Side,
  type Bytes32,
  type CredibilityProfile,
  type Hex,
  type MarketState,
  type Verdict,
} from "../../shared/schemas.js";
import type {
  CreatePactInput,
  LedgerEventHandler,
  LedgerEventName,
  LedgerPact,
  Settlement,
  TakePositionInput,
} from "../../mocks/LocalLedgerMock.js";
import type { LedgerClient } from "./ledger.js";

interface RepuFiAddresses {
  chainId?: number;
  PactMarket?: Hex;
  Resolver?: Hex;
  CredibilitySBT?: Hex;
  RepuToken?: Hex;
  contracts?: {
    PactMarket?: Hex;
    Resolver?: Hex;
    CredibilitySBT?: Hex;
    RepuToken?: Hex;
  };
}

type PactMarketContract = Contract & {
  createPact(predType: number, paramsBlob: Hex, deadline: number, overrides: { value: bigint }): Promise<ContractTransactionResponse>;
  takePosition(id: Bytes32, side: Side, overrides: { value: bigint }): Promise<ContractTransactionResponse>;
  impliedBreachProb(id: Bytes32): Promise<bigint>;
  getPact(id: Bytes32): Promise<RepuFiPactStruct>;
};

type ResolverContract = Contract & {
  submitVerdict(
    id: Bytes32,
    outcome: Outcome,
    evidenceHash: Bytes32,
    sig: Hex,
  ): Promise<ContractTransactionResponse>;
  submitDisputedVerdict(
    id: Bytes32,
    oracleOutcome: Outcome,
    agentOutcome: Outcome,
    evidenceHash: Bytes32,
    sig: Hex,
  ): Promise<ContractTransactionResponse>;
  setRelatedParty(
    id: Bytes32,
    account: Hex,
    related: boolean,
  ): Promise<ContractTransactionResponse>;
  voteReview(id: Bytes32, outcome: Outcome): Promise<ContractTransactionResponse>;
};

type CredibilityContract = Contract & {
  getProfile(subject: Hex): Promise<RepuFiProfileStruct>;
};

interface RepuFiPactStruct {
  subject: Hex;
  predicateHash: Bytes32;
  predType: bigint;
  deadline: bigint;
  bond: bigint;
  commitPool: bigint;
  skepticPool: bigint;
  outcome: bigint;
  settled: boolean;
}

interface RepuFiProfileStruct {
  score: bigint;
  kept: bigint;
  broken: bigint;
  stakedKept: bigint;
  updated: bigint;
}

export interface RepuFiLedgerOptions {
  rpcUrl?: string;
  sharedDir?: string;
  subjectPrivateKey?: string;
  skepticPrivateKey?: string;
  verifierPrivateKey?: string;
}

export class RepuFiLedgerClient implements LedgerClient {
  private readonly provider: JsonRpcProvider;
  private readonly addresses: Required<Pick<RepuFiAddresses, "PactMarket" | "Resolver" | "CredibilitySBT">>;
  private readonly marketRead: PactMarketContract;
  private readonly credibilityRead: CredibilityContract;
  private readonly subjectWallet?: Wallet;
  private readonly skepticWallet: Wallet;
  private readonly verifierWallet: Wallet;
  private readonly marketAbi: InterfaceAbi;
  private readonly resolverAbi: InterfaceAbi;

  constructor(options: RepuFiLedgerOptions = {}) {
    const sharedDir = options.sharedDir ?? resolve(process.cwd(), "shared");
    const addresses = loadAddresses(sharedDir);
    this.addresses = {
      PactMarket: requireAddress(addresses.PactMarket ?? addresses.contracts?.PactMarket, "PactMarket"),
      Resolver: requireAddress(addresses.Resolver ?? addresses.contracts?.Resolver, "Resolver"),
      CredibilitySBT: requireAddress(addresses.CredibilitySBT ?? addresses.contracts?.CredibilitySBT, "CredibilitySBT"),
    };
    this.provider = new JsonRpcProvider(options.rpcUrl ?? process.env.RPC_URL ?? "http://127.0.0.1:8545");
    this.marketAbi = loadAbi(sharedDir, "PactMarket");
    this.resolverAbi = loadAbi(sharedDir, "Resolver");
    const credibilityAbi = loadAbi(sharedDir, "CredibilitySBT");

    this.subjectWallet = optionalWallet(
      options.subjectPrivateKey ?? process.env.PRIVATE_KEY_SUBJECT ?? process.env.PRIVATE_KEY_DEPLOYER,
      this.provider,
    );
    this.skepticWallet = requiredWallet(
      options.skepticPrivateKey ?? process.env.PRIVATE_KEY_SKEPTIC,
      this.provider,
      "PRIVATE_KEY_SKEPTIC",
    );
    this.verifierWallet = requiredWallet(
      options.verifierPrivateKey ?? process.env.PRIVATE_KEY_VERIFIER,
      this.provider,
      "PRIVATE_KEY_VERIFIER",
    );

    this.marketRead = new Contract(this.addresses.PactMarket, this.marketAbi, this.provider) as unknown as PactMarketContract;
    this.credibilityRead = new Contract(
      this.addresses.CredibilitySBT,
      credibilityAbi,
      this.provider,
    ) as unknown as CredibilityContract;
  }

  async createPact(input: CreatePactInput): Promise<LedgerPact> {
    if (!this.subjectWallet) {
      throw new Error("createPact in real Ledger mode requires PRIVATE_KEY_SUBJECT or PRIVATE_KEY_DEPLOYER.");
    }
    if (this.subjectWallet.address.toLowerCase() !== input.subject.toLowerCase()) {
      throw new Error(
        `createPact subject ${input.subject} must match configured subject wallet ${this.subjectWallet.address}.`,
      );
    }

    const market = this.marketWith(this.subjectWallet);
    const tx = await market.createPact(input.predType, input.paramsBlob, input.deadline, { value: input.bond });
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("createPact transaction did not return a receipt.");
    }

    const event = findEvent(this.marketRead, receipt.logs, "PactCreated");
    const pactId = readEventArg<Bytes32>(event, "id", 0);
    return this.getPact(pactId);
  }

  async takePosition(input: TakePositionInput): Promise<MarketState> {
    const market = this.marketWith(this.skepticWallet);
    const tx = await market.takePosition(input.pactId, input.side, { value: input.amount });
    await tx.wait();

    const pact = await this.getPact(input.pactId);
    return {
      pactId: input.pactId,
      commitPool: pact.commitPool,
      skepticPool: pact.skepticPool,
      impliedBreachProb: await this.impliedBreachProb(input.pactId),
      deadline: pact.deadline,
    };
  }

  async submitVerdict(verdict: Verdict): Promise<Settlement> {
    const resolver = this.resolverWith(this.verifierWallet);
    const tx = await resolver.submitVerdict(
      verdict.pactId,
      verdict.outcome,
      verdict.evidenceHash,
      verdict.verifierSig,
    );
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("submitVerdict transaction did not return a receipt.");
    }

    const pact = await this.getPact(verdict.pactId);
    const event = findEvent(this.marketRead, receipt.logs, "Settled");
    return {
      pactId: verdict.pactId,
      outcome: verdict.outcome,
      evidenceHash: verdict.evidenceHash,
      difficulty: Number(readEventArg<bigint>(event, "closeProbBps", 3)) / 10_000,
      subject: pact.subject,
    };
  }

  async impliedBreachProb(pactId: Bytes32): Promise<number> {
    const bps = await this.marketRead.impliedBreachProb(pactId);
    return Number(bps) / 10_000;
  }

  // Submit a disputed verdict (agent outcome differs from oracle outcome) —
  // triggers human review flow on-chain via Resolver.submitDisputedVerdict.
  async submitDisputedVerdict(input: {
    pactId: Bytes32;
    oracleOutcome: Outcome;
    agentOutcome: Outcome;
    evidenceHash: Bytes32;
    verifierSig: Hex;
  }): Promise<Settlement> {
    const resolver = this.resolverWith(this.verifierWallet);
    const tx = await resolver.submitDisputedVerdict(
      input.pactId,
      input.oracleOutcome,
      input.agentOutcome,
      input.evidenceHash,
      input.verifierSig,
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("submitDisputedVerdict did not return a receipt.");
    const pact = await this.getPact(input.pactId);
    return {
      pactId: input.pactId,
      outcome: input.agentOutcome,
      evidenceHash: input.evidenceHash,
      difficulty: 0,
      subject: pact.subject,
    };
  }

  // Cast a review vote (token-holder human review after dispute).
  async voteReview(pactId: Bytes32, outcome: Outcome): Promise<void> {
    const resolver = this.resolverWith(this.verifierWallet);
    const tx = await resolver.voteReview(pactId, outcome);
    await tx.wait();
  }

  // Mark an account as a related party (interest isolation).
  async setRelatedParty(pactId: Bytes32, account: Hex, related: boolean): Promise<void> {
    const resolver = this.resolverWith(this.verifierWallet);
    const tx = await resolver.setRelatedParty(pactId, account, related);
    await tx.wait();
  }

  async getPact(pactId: Bytes32): Promise<LedgerPact> {
    const pact = await this.marketRead.getPact(pactId);
    return {
      pactId,
      subject: pact.subject,
      predicateHash: pact.predicateHash,
      deadline: Number(pact.deadline),
      bond: pact.bond,
      predType: Number(pact.predType),
      paramsBlob: "0x",
      outcome: Number(pact.outcome),
      commitPool: pact.commitPool,
      skepticPool: pact.skepticPool,
    };
  }

  async getProfile(subject: Hex): Promise<CredibilityProfile> {
    const profile = await this.credibilityRead.getProfile(subject);
    return {
      subject,
      score: profile.score,
      kept: Number(profile.kept),
      broken: Number(profile.broken),
      totalBond: profile.stakedKept,
      permanentStain: Number(profile.broken) > 0,
    };
  }

  subscribe(eventName: LedgerEventName, handler: LedgerEventHandler): () => void {
    if (eventName === "PactCreated") {
      const listener = (
        id: Bytes32,
        subject: Hex,
        predicateHash: Bytes32,
        predType: bigint,
        deadline: bigint,
        bond: bigint,
        paramsBlob: Hex,
      ) =>
        handler({
          pactId: id,
          subject,
          predicateHash,
          predType: Number(predType),
          deadline: Number(deadline),
          bond,
          paramsBlob,
        });
      this.marketRead.on("PactCreated", listener);
      return () => {
        this.marketRead.off("PactCreated", listener);
      };
    }

    if (eventName === "PositionTaken") {
      const listener = (id: Bytes32, side: bigint, account: Hex, amount: bigint, breachProbBps: bigint) =>
        handler({
          pactId: id,
          side: Number(side),
          account,
          amount,
          impliedBreachProb: Number(breachProbBps) / 10_000,
        });
      this.marketRead.on("PositionTaken", listener);
      return () => {
        this.marketRead.off("PositionTaken", listener);
      };
    }

    const listener = (id: Bytes32, outcome: bigint, evidenceHash: Bytes32, closeProbBps: bigint) =>
      handler({
        pactId: id,
        outcome: Number(outcome),
        evidenceHash,
        difficulty: Number(closeProbBps) / 10_000,
      });
    this.marketRead.on("Settled", listener);
    return () => {
      this.marketRead.off("Settled", listener);
    };
  }

  private marketWith(wallet: Wallet): PactMarketContract {
    return new Contract(this.addresses.PactMarket, this.marketAbi, wallet) as unknown as PactMarketContract;
  }

  private resolverWith(wallet: Wallet): ResolverContract {
    return new Contract(this.addresses.Resolver, this.resolverAbi, wallet) as unknown as ResolverContract;
  }
}

function loadAddresses(sharedDir: string): RepuFiAddresses {
  return JSON.parse(readFileSync(resolve(sharedDir, "addresses.json"), "utf8")) as RepuFiAddresses;
}

function loadAbi(sharedDir: string, name: string): InterfaceAbi {
  const path = resolve(sharedDir, "abis", `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing ABI for ${name}: expected ${path}. Copy it from module one shared/abis.`);
  }

  return JSON.parse(readFileSync(path, "utf8")) as InterfaceAbi;
}

function requireAddress(value: Hex | undefined, name: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`shared/addresses.json is missing ${name}.`);
  }

  return value;
}

function optionalWallet(privateKey: string | undefined, provider: JsonRpcProvider): Wallet | undefined {
  return privateKey ? new Wallet(privateKey, provider) : undefined;
}

function requiredWallet(privateKey: string | undefined, provider: JsonRpcProvider, envName: string): Wallet {
  if (!privateKey) {
    throw new Error(`${envName} is required for real Ledger mode.`);
  }

  return new Wallet(privateKey, provider);
}

function findEvent(contract: Contract, logs: readonly Log[], eventName: string): LogDescription {
  for (const log of logs) {
    const parsed = parseLog(contract, log);
    if (parsed?.name === eventName) {
      return parsed;
    }
  }

  throw new Error(`Transaction receipt did not include ${eventName}.`);
}

function parseLog(contract: Contract, log: Log): LogDescription | null {
  try {
    return contract.interface.parseLog(log);
  } catch {
    return null;
  }
}

function readEventArg<T>(event: LogDescription, name: string, index: number): T {
  return (event.args.getValue(name) ?? event.args[index]) as T;
}
