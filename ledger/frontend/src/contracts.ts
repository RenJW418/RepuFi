import { BrowserProvider, Contract, getAddress, JsonRpcProvider, ZeroAddress, type ContractRunner, type Signer } from "ethers";
import { eligibleReviewVoters, type DemoParticipant, type ReviewVoter } from "../../shared/demoWorkflow";
import { Side, type Hex } from "../../shared/schemas";
import addresses from "../../shared/addresses.json";
import credibilityAbi from "../../shared/abis/CredibilitySBT.json";
import marketAbi from "../../shared/abis/PactMarket.json";
import resolverAbi from "../../shared/abis/Resolver.json";
import repuTokenAbi from "../../shared/abis/RepuToken.json";
import { deploymentStartBlock, eventQueryRanges } from "../../shared/eventQuery";

export const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const eventStartBlock = deploymentStartBlock((addresses as { deploymentBlock?: number }).deploymentBlock);

export const demoWalletRoles = [
  { id: "browser", label: "Browser wallet", accountIndex: undefined },
  { id: "verifier", label: "Local verifier", accountIndex: 1 },
  { id: "subject", label: "Local subject", accountIndex: 2 },
  { id: "commit", label: "Local Commit bettor", accountIndex: 3 },
  { id: "skeptic", label: "Local Skeptic bettor", accountIndex: 4 },
  { id: "reviewer", label: "Local REPU reviewer", accountIndex: 7 },
  { id: "owner", label: "Local owner", accountIndex: 0 }
] as const;

export type DemoWalletRoleId = (typeof demoWalletRoles)[number]["id"];

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

export type ReviewVoterRow = ReviewVoter;

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

export function getReadContracts(provider: ContractRunner = readProvider()) {
  return {
    market: new Contract(addresses.PactMarket, marketAbi, provider),
    resolver: new Contract(addresses.Resolver, resolverAbi, provider),
    credibility: new Contract(addresses.CredibilitySBT, credibilityAbi, provider),
    reviewToken: new Contract(addresses.RepuToken, repuTokenAbi, provider)
  };
}

export async function getWriteContracts(roleId: DemoWalletRoleId = "browser") {
  const role = demoWalletRoles.find((item) => item.id === roleId) ?? demoWalletRoles[0];
  const signer = await signerForRole(role);
  return {
    account: await signer.getAddress(),
    label: role.label,
    signer,
    market: new Contract(addresses.PactMarket, marketAbi, signer),
    resolver: new Contract(addresses.Resolver, resolverAbi, signer),
    credibility: new Contract(addresses.CredibilitySBT, credibilityAbi, signer),
    reviewToken: new Contract(addresses.RepuToken, repuTokenAbi, signer)
  };
}

export async function getLocalVerifierSigner(): Promise<Signer> {
  return readProvider().getSigner(1);
}

async function signerForRole(role: (typeof demoWalletRoles)[number]): Promise<Signer> {
  if (role.id === "browser") {
    const provider = await walletProvider();
    return provider.getSigner();
  }

  const provider = readProvider();
  return provider.getSigner(role.accountIndex);
}

export async function loadPactCreated(): Promise<PactRow[]> {
  const { market } = getReadContracts();
  const filter = market.filters.PactCreated();
  const logs = await queryEvents(market, filter);
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
  const logs = await queryEvents(market, filter);
  return logs.map((log: any) => ({
    blockNumber: Number(log.blockNumber),
    account: log.args.account as string,
    side: Number(log.args.side),
    amount: log.args.amount as bigint,
    breachProbBps: log.args.breachProbBps as bigint
  }));
}

export async function loadReviewVoters(pactId: string): Promise<ReviewVoterRow[]> {
  const { market, resolver, reviewToken } = getReadContracts();
  const [pact, positions, relatedParties, tokenHolders] = await Promise.all([
    market.getPact(pactId),
    loadPriceHistory(pactId),
    loadRelatedParties(resolver, pactId),
    loadTokenHolders(reviewToken)
  ]);
  const subject = normalizeAddress(pact.subject);
  const participants = uniqueParticipants(positions);
  const candidates = uniqueAddresses([
    subject,
    ...participants.map((participant) => participant.address),
    ...relatedParties,
    ...tokenHolders
  ]);

  return eligibleReviewVoters({
    subject,
    participants,
    relatedParties,
    tokenHolders: candidates
  });
}

async function loadRelatedParties(resolver: Contract, pactId: string): Promise<Hex[]> {
  const filter = resolver.filters.RelatedPartySet(pactId);
  const logs = await queryEvents(resolver, filter);
  const related = new Set<string>();
  for (const log of logs as any[]) {
    const account = normalizeAddress(log.args.account);
    if (log.args.related) {
      related.add(account);
    } else {
      related.delete(account);
    }
  }
  return Array.from(related) as Hex[];
}

async function loadTokenHolders(reviewToken: Contract): Promise<Hex[]> {
  const filter = reviewToken.filters.Transfer();
  const logs = await queryEvents(reviewToken, filter);
  const candidates = uniqueAddresses(
    (logs as any[])
      .flatMap((log) => [log.args.from as string, log.args.to as string])
      .filter((address) => normalizeAddress(address) !== normalizeAddress(ZeroAddress))
  );
  const balances = await Promise.all(candidates.map((address) => reviewToken.balanceOf(address)));
  return candidates.filter((_, index) => balances[index] > 0n);
}

function uniqueParticipants(positions: PricePoint[]): DemoParticipant[] {
  const byAddress = new Map<string, DemoParticipant>();
  for (const point of positions) {
    const address = normalizeAddress(point.account);
    if (!byAddress.has(address)) {
      byAddress.set(address, {
        address,
        side: point.side === Side.Commit ? Side.Commit : Side.Skeptic
      });
    }
  }
  return Array.from(byAddress.values());
}

function uniqueAddresses(addresses: string[]): Hex[] {
  return Array.from(new Set(addresses.map(normalizeAddress))) as Hex[];
}

function normalizeAddress(address: string): Hex {
  return getAddress(address).toLowerCase() as Hex;
}

async function queryEvents(contract: Contract, filter: ReturnType<Contract["filters"][string]>) {
  const provider = blockNumberProvider(contract);
  const latestBlock = await provider.getBlockNumber();

  const logs = [];
  for (const range of eventQueryRanges(eventStartBlock, latestBlock)) {
    logs.push(...(await contract.queryFilter(filter, range.fromBlock, range.toBlock)));
  }
  return logs;
}

function blockNumberProvider(contract: Contract): { getBlockNumber: () => Promise<number> } {
  const runner = contract.runner as
    | {
        getBlockNumber?: () => Promise<number>;
        provider?: { getBlockNumber?: () => Promise<number> };
      }
    | undefined;
  const provider = runner?.provider ?? runner;
  if (!provider?.getBlockNumber) {
    throw new Error("Read provider does not expose block numbers.");
  }
  return { getBlockNumber: provider.getBlockNumber.bind(provider) };
}
