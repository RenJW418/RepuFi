import { ethers } from "hardhat";
import { compileDemoPredicate, demoScenarioTemplates } from "../shared/demoWorkflow";
import { Outcome, Side } from "../shared/schemas";

async function createPact(subject: any, market: any, scenario: (typeof demoScenarioTemplates)[number], index: number) {
  const predicate = compileDemoPredicate(scenario);
  const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 120 + index);
  const tx = await market.connect(subject).createPact(predicate.predType, predicate.paramsBlob, deadline, {
    value: ethers.parseEther(scenario.defaultStakeEth),
  });
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

  return { id: event!.args.id as string, predicate };
}

async function main() {
  const [owner, verifier, subject, commit, skeptic, insurance, community] = await ethers.getSigners();

  const credibility = await ethers.deployContract("CredibilitySBT", [owner.address]);
  const market = await ethers.deployContract("PactMarket", [owner.address, await credibility.getAddress()]);
  const resolver = await ethers.deployContract("Resolver", [owner.address, await market.getAddress()]);

  await credibility.waitForDeployment();
  await market.waitForDeployment();
  await resolver.waitForDeployment();

  await (await credibility.setMarket(await market.getAddress())).wait();
  await (await market.setResolver(await resolver.getAddress())).wait();
  await (await market.setTreasuries(insurance.address, community.address)).wait();
  await (await resolver.setVerifier(verifier.address, true)).wait();

  const results = [];
  for (const [index, scenario] of demoScenarioTemplates.entries()) {
    const pact = await createPact(subject, market, scenario, index);
    await (await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("0.5") })).wait();
    await (await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("0.5") })).wait();

    const outcome = index === 1 ? Outcome.Breached : Outcome.Kept;
    const evidenceHash = ethers.id(`${scenario.id}:${outcome}`);
    const digest = await resolver.verdictDigest(pact.id, outcome, evidenceHash);
    const sig = await verifier.signMessage(ethers.getBytes(digest));
    await (await resolver.submitVerdict(pact.id, outcome, evidenceHash, sig)).wait();

    const winner = outcome === Outcome.Kept ? commit : skeptic;
    await (await market.connect(winner).claim(pact.id)).wait();
    const stored = await market.getPact(pact.id);
    const profile = await credibility.profileOf(subject.address);

    results.push({
      id: scenario.id,
      title: scenario.title,
      predType: pact.predicate.predType,
      outcome: outcome === Outcome.Kept ? "Kept" : "Breached",
      settled: stored.settled,
      winner: outcome === Outcome.Kept ? "Commit" : "Skeptic",
      profile: {
        kept: Number(profile.kept),
        broken: Number(profile.broken),
      },
    });
  }

  console.log(JSON.stringify({ scenarios: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
