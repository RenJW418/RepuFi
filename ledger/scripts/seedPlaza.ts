import { ethers } from "hardhat";
import addresses from "../shared/addresses.json";
import { compileDemoPredicate, demoScenarioTemplates } from "../shared/demoWorkflow";
import { Side } from "../shared/schemas";

async function main() {
  const [, , subject, commit, skeptic] = await ethers.getSigners();
  const market = await ethers.getContractAt("PactMarket", addresses.PactMarket);
  const results = [];

  for (const [index, scenario] of demoScenarioTemplates.entries()) {
    const predicate = compileDemoPredicate(scenario);
    const latest = await ethers.provider.getBlock("latest");
    const deadline = BigInt(latest!.timestamp + Number(scenario.defaultDeadlineMinutes) * 60 + index);
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
    const pactId = event!.args.id as string;

    await (await market.connect(commit).takePosition(pactId, Side.Commit, { value: ethers.parseEther("0.6") })).wait();
    await (
      await market.connect(skeptic).takePosition(pactId, Side.Skeptic, {
        value: ethers.parseEther(index === 0 ? "0.4" : "0.8"),
      })
    ).wait();

    results.push({
      id: scenario.id,
      title: scenario.title,
      pactId,
      predType: predicate.predType,
      params: predicate.paramsSummary,
    });
  }

  console.log(JSON.stringify({ plaza: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
