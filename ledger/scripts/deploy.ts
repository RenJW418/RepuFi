import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifacts, ethers } from "hardhat";

async function main() {
  const [deployer, verifier, , , , insurance, community, reviewer] = await ethers.getSigners();

  const credibility = await ethers.deployContract("CredibilitySBT", [deployer.address]);
  await credibility.waitForDeployment();

  const market = await ethers.deployContract("PactMarket", [deployer.address, await credibility.getAddress()]);
  await market.waitForDeployment();

  const resolver = await ethers.deployContract("Resolver", [deployer.address, await market.getAddress()]);
  await resolver.waitForDeployment();

  const reviewToken = await ethers.deployContract("RepuToken", [deployer.address]);
  await reviewToken.waitForDeployment();

  const adapter = await ethers.deployContract("OnchainMilestoneAdapter");
  await adapter.waitForDeployment();

  await (await credibility.setMarket(await market.getAddress())).wait();
  await (await market.setResolver(await resolver.getAddress())).wait();
  await (await market.setTreasuries(insurance.address, community.address)).wait();
  await (await resolver.setVerifier(verifier.address, true)).wait();
  await (await resolver.setReviewToken(await reviewToken.getAddress())).wait();
  await (await reviewToken.mint(reviewer.address, ethers.parseEther("100"))).wait();
  await (await resolver.setAdapter(1, await adapter.getAddress())).wait();

  const addresses = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    verifier: verifier.address,
    insuranceTreasury: insurance.address,
    communityTreasury: community.address,
    reviewer: reviewer.address,
    CredibilitySBT: await credibility.getAddress(),
    PactMarket: await market.getAddress(),
    Resolver: await resolver.getAddress(),
    RepuToken: await reviewToken.getAddress(),
    OnchainMilestoneAdapter: await adapter.getAddress()
  };

  mkdirSync("shared/abis", { recursive: true });
  writeFileSync("shared/addresses.json", `${JSON.stringify(addresses, null, 2)}\n`);

  for (const name of ["CredibilitySBT", "PactMarket", "Resolver", "RepuToken", "OnchainMilestoneAdapter"]) {
    const artifact = await artifacts.readArtifact(name);
    writeFileSync(join("shared/abis", `${name}.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  }

  console.log(addresses);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
