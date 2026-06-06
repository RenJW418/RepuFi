import { expect } from "chai";
import { ethers } from "hardhat";
import { Outcome, PredType, Side } from "../shared/schemas";

const ONE = ethers.parseEther("1");
const ZERO_BYTES32 = ethers.ZeroHash;

async function setup() {
  const [owner, verifier, subject, commit, skeptic, outsider] = await ethers.getSigners();
  const credibility = await ethers.deployContract("CredibilitySBT", [owner.address]);
  const market = await ethers.deployContract("PactMarket", [owner.address, await credibility.getAddress()]);
  const resolver = await ethers.deployContract("Resolver", [owner.address, await market.getAddress()]);
  const adapter = await ethers.deployContract("OnchainMilestoneAdapter");
  const milestone = await ethers.deployContract("MockMilestone");

  await credibility.waitForDeployment();
  await market.waitForDeployment();
  await resolver.waitForDeployment();
  await adapter.waitForDeployment();
  await milestone.waitForDeployment();

  await credibility.setMarket(await market.getAddress());
  await market.setResolver(await resolver.getAddress());
  await resolver.setVerifier(verifier.address, true);
  await resolver.setAdapter(PredType.ONCHAIN_MILESTONE, await adapter.getAddress());

  async function create(target: string, bond = ONE) {
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
    const paramsBlob = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [target]);
    const tx = await market.connect(subject).createPact(PredType.ONCHAIN_MILESTONE, paramsBlob, deadline, {
      value: bond
    });
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => {
        try {
          return market.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "PactCreated");
    return { id: event!.args.id as string, paramsBlob, deadline };
  }

  return { owner, verifier, subject, commit, skeptic, outsider, credibility, market, resolver, adapter, milestone, create };
}

describe("PACT Ledger", function () {
  it("creates a pact and prices empty and funded pools", async function () {
    const { market, commit, skeptic, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());

    expect(await market.impliedBreachProb(pact.id)).to.equal(5000);

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });

    expect(await market.impliedBreachProb(pact.id)).to.equal(7000);
  });

  it("settles kept pacts, pays commit side, returns bond, and adds difficulty-weighted credibility", async function () {
    const { subject, commit, skeptic, credibility, market, resolver, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress(), ONE);

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });

    await expect(() => resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, pact.paramsBlob)).to.changeEtherBalances(
      [subject],
      [ONE]
    );

    const expectedPayout = ethers.parseEther("10");
    await expect(() => market.connect(commit).claim(pact.id)).to.changeEtherBalances([commit], [expectedPayout]);

    const profile = await credibility.profileOf(subject.address);
    expect(profile.score).to.equal(ethers.parseEther("0.7"));
    expect(profile.kept).to.equal(1);
    expect(profile.broken).to.equal(0);
    expect(profile.stakedKept).to.equal(ONE);
  });

  it("settles breached pacts by putting bond into skeptic reward pool and debits credibility", async function () {
    const { subject, commit, skeptic, credibility, market, resolver, create } = await setup();
    const pact = await create(ethers.ZeroAddress, ONE);

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(pact.deadline) + 1]);
    await ethers.provider.send("evm_mine", []);
    await resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, pact.paramsBlob);

    const expectedPayout = ethers.parseEther("11");
    await expect(() => market.connect(skeptic).claim(pact.id)).to.changeEtherBalances([skeptic], [expectedPayout]);

    const profile = await credibility.profileOf(subject.address);
    expect(profile.score).to.equal(-ONE);
    expect(profile.kept).to.equal(0);
    expect(profile.broken).to.equal(1);
  });

  it("rejects repeat claims and non-winner claims", async function () {
    const { commit, skeptic, market, resolver, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });
    await resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, pact.paramsBlob);

    await expect(market.connect(skeptic).claim(pact.id)).to.be.revertedWithCustomError(market, "NothingToClaim");
    await market.connect(commit).claim(pact.id);
    await expect(market.connect(commit).claim(pact.id)).to.be.revertedWithCustomError(market, "NothingToClaim");
  });

  it("keeps CredibilitySBT soulbound", async function () {
    const { subject, commit, outsider, credibility, market, resolver, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("1") });
    await resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, pact.paramsBlob);

    const tokenId = await credibility.tokenIdOf(subject.address);
    await expect(
      credibility.connect(subject).transferFrom(subject.address, outsider.address, tokenId)
    ).to.be.revertedWithCustomError(credibility, "Soulbound");
  });

  it("accepts authorized EIP-191 verdict signatures and rejects unauthorized signatures", async function () {
    const { verifier, outsider, commit, skeptic, market, resolver, create } = await setup();
    const pact = await create(ethers.ZeroAddress);

    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });

    const evidence = ethers.keccak256(ethers.toUtf8Bytes("demo"));
    const digest = await resolver.verdictDigest(pact.id, Outcome.Breached, evidence);
    const badSig = await outsider.signMessage(ethers.getBytes(digest));

    await expect(resolver.submitVerdict(pact.id, Outcome.Breached, evidence, badSig)).to.be.revertedWithCustomError(
      resolver,
      "UnauthorizedVerifier"
    );

    const sig = await verifier.signMessage(ethers.getBytes(digest));
    expect(await resolver.recoverVerifier(pact.id, Outcome.Breached, evidence, sig)).to.equal(verifier.address);
    await expect(resolver.submitVerdict(pact.id, Outcome.Breached, evidence, sig))
      .to.emit(market, "Settled")
      .withArgs(pact.id, Outcome.Breached, evidence, 7000);
  });

  it("rejects selfResolve when predicate params do not match the pact hash", async function () {
    const { resolver, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());
    const wrongParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);

    await expect(resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, wrongParams)).to.be.revertedWithCustomError(
      resolver,
      "PredicateMismatch"
    );
  });

  it("does not allow a missing milestone to be breached before deadline", async function () {
    const { resolver, create } = await setup();
    const pact = await create(ethers.ZeroAddress);

    await expect(resolver.selfResolve(pact.id, PredType.ONCHAIN_MILESTONE, pact.paramsBlob)).to.be.revertedWithCustomError(
      resolver,
      "TooEarlyToBreach"
    );
  });

  it("can snapshot close after deadline", async function () {
    const { commit, skeptic, market, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());
    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: ethers.parseEther("7") });

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(pact.deadline) + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(market.snapshotClose(pact.id)).to.emit(market, "CloseSnapshotted").withArgs(pact.id, 7000);
  });

  it("snapshots a real 0 bps close probability exactly once", async function () {
    const { commit, market, milestone, create } = await setup();
    const pact = await create(await milestone.getAddress());
    await market.connect(commit).takePosition(pact.id, Side.Commit, { value: ethers.parseEther("3") });

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(pact.deadline) + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(market.snapshotClose(pact.id)).to.emit(market, "CloseSnapshotted").withArgs(pact.id, 0);
    await expect(market.snapshotClose(pact.id)).to.not.emit(market, "CloseSnapshotted");

    const stored = await market.getPact(pact.id);
    expect(stored.closeProbBps).to.equal(0);
    expect(stored.closeSnapshotted).to.equal(true);
  });

  it("preserves funds across multiple winners and pays dust to the final claimant", async function () {
    const { subject, commit, skeptic, outsider, market, resolver, create } = await setup();
    const pact = await create(ethers.ZeroAddress, 1n);

    await market.connect(commit).takePosition(pact.id, Side.Skeptic, { value: 2n });
    await market.connect(skeptic).takePosition(pact.id, Side.Skeptic, { value: 1n });
    await market.connect(outsider).takePosition(pact.id, Side.Commit, { value: 1n });

    const evidence = ethers.keccak256(ethers.toUtf8Bytes("dust"));
    const [, verifier] = await ethers.getSigners();
    const digest = await resolver.verdictDigest(pact.id, Outcome.Breached, evidence);
    const sig = await verifier.signMessage(ethers.getBytes(digest));
    await resolver.submitVerdict(pact.id, Outcome.Breached, evidence, sig);

    await expect(() => market.connect(commit).claim(pact.id)).to.changeEtherBalances([commit], [3n]);
    await expect(() => market.connect(skeptic).claim(pact.id)).to.changeEtherBalances([skeptic], [2n]);

    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0);
    const profile = await (await ethers.getContractAt("CredibilitySBT", await market.credibility())).profileOf(subject.address);
    expect(profile.broken).to.equal(1);
  });
});
