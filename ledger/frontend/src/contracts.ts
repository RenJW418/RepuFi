import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import addresses from "../../shared/addresses.json";
import credibilityAbi from "../../shared/abis/CredibilitySBT.json";
import marketAbi from "../../shared/abis/PactMarket.json";
import resolverAbi from "../../shared/abis/Resolver.json";

export const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";

export type Pact = {
  subject: string;
  predicateHash: string;
  predType: bigint;
  deadline: bigint;
  bond: bigint;
  commitPool: bigint;
  skepticPool: bigint;
  rewardPool: bigint;
  insurancePool: bigint;
  communityPool: bigint;
  closeProbBps: bigint;
  closeSnapshotted: boolean;
  outcome: bigint;
  settled: boolean;
};

export type PactRow = {
  id: string;
  subject: string;
  predicateHash: string;
  predType: number;
  deadline: number;
  bond: bigint;
  paramsBlob: string;
};

export type PricePoint = {
  blockNumber: number;
  account: string;
  side: number;
  amount: bigint;
  breachProbBps: bigint;
};

export function readProvider() {
  return new JsonRpcProvider(rpcUrl);
}

export async function walletProvider() {
  const eth = (window as any).ethereum;
  if (!eth) {
    throw new Error("Wallet provider not found");
  }
  await eth.request({ method: "eth_requestAccounts" });
  return new BrowserProvider(eth);
}

export function getReadContracts(provider = readProvider()) {
  return {
    market: new Contract(addresses.PactMarket, marketAbi, provider),
    resolver: new Contract(addresses.Resolver, resolverAbi, provider),
    credibility: new Contract(addresses.CredibilitySBT, credibilityAbi, provider)
  };
}

export async function getWriteContracts() {
  const provider = await walletProvider();
  const signer = await provider.getSigner();
  return {
    account: await signer.getAddress(),
    market: new Contract(addresses.PactMarket, marketAbi, signer),
    resolver: new Contract(addresses.Resolver, resolverAbi, signer),
    credibility: new Contract(addresses.CredibilitySBT, credibilityAbi, signer)
  };
}

export async function loadPactCreated(): Promise<PactRow[]> {
  const { market } = getReadContracts();
  const filter = market.filters.PactCreated();
  const logs = await market.queryFilter(filter, 0, "latest");
  return logs
    .map((log: any) => ({
      id: log.args.id as string,
      subject: log.args.subject as string,
      predicateHash: log.args.predicateHash as string,
      predType: Number(log.args.predType),
      deadline: Number(log.args.deadline),
      bond: log.args.bond as bigint,
      paramsBlob: log.args.paramsBlob as string
    }))
    .reverse();
}

export async function loadPriceHistory(pactId: string): Promise<PricePoint[]> {
  const { market } = getReadContracts();
  const filter = market.filters.PositionTaken(pactId);
  const logs = await market.queryFilter(filter, 0, "latest");
  return logs.map((log: any) => ({
    blockNumber: Number(log.blockNumber),
    account: log.args.account as string,
    side: Number(log.args.side),
    amount: log.args.amount as bigint,
    breachProbBps: log.args.breachProbBps as bigint
  }));
}
