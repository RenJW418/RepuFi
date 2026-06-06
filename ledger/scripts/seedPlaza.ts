import hre, { ethers } from "hardhat";
import addresses from "../shared/addresses.json";
import { compileDemoPredicate, demoScenarioTemplates } from "../shared/demoWorkflow";
import { Side } from "../shared/schemas";

async function main() {
  const signers = await ethers.getSigners();
  const subject = signers[2] ?? signers[0];
  const commit = signers[3] ?? signers[0];
  const skeptic = signers[4] ?? signers[0];
  if (!subject || !commit || !skeptic) {
    throw new Error("Seeding plaza requires at least one signer.");
  }
  const market = await ethers.getContractAt("PactMarket", addresses.PactMarket);
  const results = [];

  for (const [index, scenario] of demoScenarioTemplates.entries()) {
    const predicate = compileDemoPredicate(scenario);
    const amounts = seedAmounts(scenario.defaultStakeEth, index);
    const latest = await ethers.provider.getBlock("latest");
    const deadline = BigInt(latest!.timestamp + Number(scenario.defaultDeadlineMinutes) * 60 + index);
    const tx = await market.connect(subject).createPact(predicate.predType, predicate.paramsBlob, deadline, {
      value: ethers.parseEther(amounts.bondEth),
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

    await (await market.connect(commit).takePosition(pactId, Side.Commit, { value: ethers.parseEther(amounts.commitEth) })).wait();
    await (
      await market.connect(skeptic).takePosition(pactId, Side.Skeptic, {
        value: ethers.parseEther(amounts.skepticEth),
      })
    ).wait();

    results.push({
      id: scenario.id,
      title: scenario.title,
      pactId,
      predType: predicate.predType,
      params: predicate.paramsSummary,
      amounts,
    });
  }

  console.log(JSON.stringify({ plaza: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function seedAmounts(defaultBondEth: string, index: number) {
  if (hre.network.name !== "testnet") {
    return {
      bondEth: defaultBondEth,
      commitEth: "0.6",
      skepticEth: index === 0 ? "0.4" : "0.8",
    };
  }

  return {
    bondEth: process.env.REPUFI_SEED_BOND_ETH ?? "0.001",
    commitEth: process.env.REPUFI_SEED_COMMIT_ETH ?? "0.0003",
    skepticEth: process.env.REPUFI_SEED_SKEPTIC_ETH ?? (index === 0 ? "0.0002" : "0.0004"),
  };
}
