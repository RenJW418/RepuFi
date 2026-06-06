import { ethers } from "hardhat";
import { Outcome, PredType, Side } from "../shared/schemas";

const ONE = ethers.parseEther("1");

async function createPact(subject: any, market: any, target: string, bond = ONE) {
  const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 60);
  const paramsBlob = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [target]);
  const tx = await market.connect(subject).createPact(PredType.ONCHAIN_MILESTONE, paramsBlob, deadline, { value: bond });
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((log: any) => {
      try {
        return market.interface.parseLog(log);
      } catch {
        return undefined;
      }
    })
    .find((event: any) => event?.name === "PactCreated");
  return { id: event!.args.id as string, paramsBlob };
}

async function main() {
  const [deployer, verifier, subject, commit, skeptic] = await ethers.getSigners();

  const credibility = await ethers.deployContract("CredibilitySBT", [deployer.address]);
  const market = await ethers.deployContract("PactMarket", [deployer.address, await credibility.getAddress()]);
  const resolver = await ethers.deployContract("Resolver", [deployer.address, await market.getAddress()]);
  const adapter = await ethers.deployContract("OnchainMilestoneAdapter");
  const milestone = await ethers.deployContract("MockMilestone");

  await credibility.waitForDeployment();
  await market.waitForDeployment();
  await resolver.waitForDeployment();
  await adapter.waitForDeployment();
  await milestone.waitForDeployment();

  await (await credibility.setMarket(await market.getAddress())).wait();
  await (await market.setResolver(await resolver.getAddress())).wait();
  await (await resolver.setVerifier(verifier.address, true)).wait();
  await (await resolver.setAdapter(PredType.ONCHAIN_MILESTONE, await adapter.getAddress())).wait();

  const kept = await createPact(subject, market, await milestone.getAddress());
  await (await market.connect(commit).takePosition(kept.id, Side.Commit, { value: ethers.parseEther("3") })).wait();
  await (await market.connect(skeptic).takePosition(kept.id, Side.Skeptic, { value: ethers.parseEther("7") })).wait();
  console.log("kept price bps:", String(await market.impliedBreachProb(kept.id)));
  await (await resolver.selfResolve(kept.id, PredType.ONCHAIN_MILESTONE, kept.paramsBlob)).wait();
  await (await market.connect(commit).claim(kept.id)).wait();
  console.log("kept profile:", await credibility.profileOf(subject.address));

  const breached = await createPact(subject, market, ethers.ZeroAddress);
  await (await market.connect(commit).takePosition(breached.id, Side.Commit, { value: ethers.parseEther("3") })).wait();
  await (await market.connect(skeptic).takePosition(breached.id, Side.Skeptic, { value: ethers.parseEther("7") })).wait();
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("manual-breach-demo"));
  const digest = await resolver.verdictDigest(breached.id, Outcome.Breached, evidenceHash);
  const sig = await verifier.signMessage(ethers.getBytes(digest));
  await (await resolver.submitVerdict(breached.id, Outcome.Breached, evidenceHash, sig)).wait();
  await (await market.connect(skeptic).claim(breached.id)).wait();
  console.log("breached profile:", await credibility.profileOf(subject.address));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
