import { expect } from "chai";

import {
  analyzeGoalForDemo,
  buildDemoResolution,
  compileDemoPredicate,
  demoScenarioTemplates,
  eligibleReviewVoters
} from "../shared/demoWorkflow";
import { Outcome, PredType, Side } from "../shared/schemas";

describe("Demo workflow", function () {
  it("rejects broad goals that are not measurable, time-bound, and evidence-backed", function () {
    const analysis = analyzeGoalForDemo({
      goal: "我要变得更好",
      stakeEth: "1",
      scenarioId: "l1-habit"
    });

    expect(analysis.accepted).to.equal(false);
    expect(analysis.reasons).to.include("目标缺少可量化数字");
    expect(analysis.reasons).to.include("目标缺少明确到期时间");
    expect(analysis.reasons).to.include("目标缺少客观证据来源");
  });

  it("accepts and compiles the three documented demo cases into deterministic predicates", function () {
    const compiled = demoScenarioTemplates.map((template) => {
      const analysis = analyzeGoalForDemo({
        goal: template.goal,
        stakeEth: template.defaultStakeEth,
        scenarioId: template.id
      });
      const predicate = compileDemoPredicate(template);
      return { analysis, predicate };
    });

    expect(compiled.map((entry) => entry.analysis.accepted)).to.deep.equal([true, true, true]);
    expect(compiled.map((entry) => entry.predicate.predType)).to.deep.equal([
      PredType.HABIT,
      PredType.ONCHAIN_MILESTONE,
      PredType.POLICY
    ]);
    for (const entry of compiled) {
      expect(entry.predicate.paramsBlob).to.match(/^0x[0-9a-f]+$/);
    }
  });

  it("finalizes from the optimistic oracle when multi-agent consensus agrees", function () {
    const resolution = buildDemoResolution({
      scenario: demoScenarioTemplates[0],
      oracleOutcome: Outcome.Kept,
      agentOutcomes: [Outcome.Kept, Outcome.Kept, Outcome.Kept],
      participants: [],
      relatedParties: []
    });

    expect(resolution.agentConsensus).to.equal(Outcome.Kept);
    expect(resolution.needsHumanReview).to.equal(false);
    expect(resolution.finalOutcome).to.equal(Outcome.Kept);
    expect(resolution.timeline.map((step) => step.label)).to.deep.equal([
      "Oracle proposal",
      "Challenge window",
      "Final settlement"
    ]);
  });

  it("escalates disagreement to token-holder review and excludes conflicted voters", function () {
    const participants = [
      { address: "0x1000000000000000000000000000000000000001", side: Side.Commit },
      { address: "0x2000000000000000000000000000000000000002", side: Side.Skeptic }
    ] as const;
    const relatedParties = ["0x3000000000000000000000000000000000000003"] as const;
    const voters = eligibleReviewVoters({
      subject: "0x4000000000000000000000000000000000000004",
      participants,
      relatedParties,
      tokenHolders: [
        "0x1000000000000000000000000000000000000001",
        "0x2000000000000000000000000000000000000002",
        "0x3000000000000000000000000000000000000003",
        "0x4000000000000000000000000000000000000004",
        "0x5000000000000000000000000000000000000005"
      ]
    });
    const resolution = buildDemoResolution({
      scenario: demoScenarioTemplates[2],
      oracleOutcome: Outcome.Kept,
      agentOutcomes: [Outcome.Breached, Outcome.Breached, Outcome.Kept],
      participants,
      relatedParties,
      reviewVoters: voters
    });

    expect(resolution.agentConsensus).to.equal(Outcome.Breached);
    expect(resolution.needsHumanReview).to.equal(true);
    expect(voters.filter((voter) => voter.eligible).map((voter) => voter.address)).to.deep.equal([
      "0x5000000000000000000000000000000000000005"
    ]);
    expect(voters.filter((voter) => !voter.eligible).map((voter) => voter.reason)).to.deep.equal([
      "已参与该市场",
      "已参与该市场",
      "关联方隔离",
      "发起人隔离"
    ]);
    expect(resolution.finalOutcome).to.equal(Outcome.Breached);
    expect(resolution.timeline.map((step) => step.label)).to.deep.equal([
      "Oracle proposal",
      "Multi-agent disagreement",
      "Token-holder review",
      "Final settlement"
    ]);
  });
});
