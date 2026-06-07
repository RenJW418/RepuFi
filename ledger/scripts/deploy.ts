import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import hre, { artifacts, ethers } from "hardhat";

async function main() {
  assertTestnetEnv();

  const signers = await ethers.getSigners();
  const roles = resolveDeploymentRoles(signers);
  const deployer = roles.deployer;
  const deploymentStartBlock = await ethers.provider.getBlockNumber();

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
  await (await market.setTreasuries(roles.insuranceTreasury, roles.communityTreasury)).wait();
  await (await resolver.setVerifier(roles.verifier, true)).wait();
  await (await resolver.setReviewToken(await reviewToken.getAddress())).wait();
  await (await reviewToken.mint(roles.reviewer, ethers.parseEther("100"))).wait();
  await (await resolver.setAdapter(1, await adapter.getAddress())).wait();

  const addresses = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deploymentBlock: deploymentStartBlock,
    deployer: deployer.address,
    verifier: roles.verifier,
    insuranceTreasury: roles.insuranceTreasury,
    communityTreasury: roles.communityTreasury,
    reviewer: roles.reviewer,
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

function assertTestnetEnv() {
  if (hre.network.name !== "testnet") return;

  const missing = [
    "REPUFI_TESTNET_RPC_URL",
    "REPUFI_TESTNET_CHAIN_ID",
    "REPUFI_TESTNET_PRIVATE_KEY"
  ].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing testnet deployment env: ${missing.join(", ")}`);
  }
  const chainId = Number(process.env.REPUFI_TESTNET_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("REPUFI_TESTNET_CHAIN_ID must be a positive integer.");
  }
}

function resolveDeploymentRoles(signers: Awaited<ReturnType<typeof ethers.getSigners>>) {
  const deployer = signers[0];
  if (!deployer) {
    throw new Error("Deployment requires at least one signer.");
  }

  return {
    deployer,
    verifier: envAddress("REPUFI_TESTNET_VERIFIER_ADDRESS") ?? signers[1]?.address ?? deployer.address,
    insuranceTreasury: envAddress("REPUFI_TESTNET_INSURANCE_TREASURY") ?? signers[5]?.address ?? deployer.address,
    communityTreasury: envAddress("REPUFI_TESTNET_COMMUNITY_TREASURY") ?? signers[6]?.address ?? deployer.address,
    reviewer: envAddress("REPUFI_TESTNET_REVIEWER_ADDRESS") ?? signers[7]?.address ?? deployer.address
  };
}

function envAddress(key: string) {
  const value = process.env[key]?.trim();
  if (!value) return undefined;
  if (!ethers.isAddress(value)) {
    throw new Error(`${key} must be a valid EVM address.`);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
