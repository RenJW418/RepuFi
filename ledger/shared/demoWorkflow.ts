import { AbiCoder, getAddress, isAddress, keccak256, toUtf8Bytes } from "ethers";

import { Outcome, PredType, Side, type Hex, type Tier } from "./schemas";

const abi = AbiCoder.defaultAbiCoder();

export type ScenarioCategory = "Personal Discipline" | "Project Delivery" | "Public Accountability";

export interface DemoScenarioTemplate {
  id: "l1-habit" | "l2-delivery" | "l3-policy";
  tier: Tier;
  category: ScenarioCategory;
  title: string;
  goal: string;
  measurement: string;
  evidence: string;
  defaultStakeEth: string;
  defaultDeadlineMinutes: string;
  expectedKeptEvidence: string;
  expectedBreachedEvidence: string;
}

export interface GoalAnalysis {
  accepted: boolean;
  score: number;
  reasons: string[];
  normalizedGoal: string;
  tier: Tier;
  category: ScenarioCategory;
  quantifier: string;
  deadline: string;
  evidenceSource: string;
}

export interface DemoPredicate {
  goal: string;
  tier: Tier;
  predType: PredType;
  paramsBlob: Hex;
  paramsSummary: string;
}

export interface DemoParticipant {
  address: Hex;
  side: Side;
}

export interface ReviewVoter {
  address: Hex;
  eligible: boolean;
  reason: "可投票" | "已参与该市场" | "发起人隔离" | "关联方隔离";
}

export interface ResolutionTimelineStep {
  label: string;
  detail: string;
}

export interface DemoResolution {
  oracleOutcome: Outcome.Kept | Outcome.Breached;
  agentOutcomes: Array<Outcome.Kept | Outcome.Breached>;
  agentConsensus: Outcome.Kept | Outcome.Breached;
  needsHumanReview: boolean;
  finalOutcome: Outcome.Kept | Outcome.Breached;
  reviewVoters: ReviewVoter[];
  timeline: ResolutionTimelineStep[];
  distribution: {
    winnerSide: Side;
    winnerReceives: string;
    protocolBuckets: string;
  };
}

export const demoScenarioTemplates: DemoScenarioTemplate[] = [
  {
    id: "l1-habit",
    tier: "L1",
    category: "Personal Discipline",
    title: "30-day morning run",
    goal: "30 天内完成 24 次晨跑，每次至少 2 公里",
    measurement: "24/30 次 GPS 或打卡记录，每次距离 >= 2 公里",
    evidence: "运动 App 截图、GPS 轨迹、连续打卡记录",
    defaultStakeEth: "1",
    defaultDeadlineMinutes: "30",
    expectedKeptEvidence: "已提交 26 次有效晨跑记录",
    expectedBreachedEvidence: "只提交 15 次有效晨跑记录",
  },
  {
    id: "l2-delivery",
    tier: "L2",
    category: "Project Delivery",
    title: "Q3 mainnet launch",
    goal: "Q3 结束前完成主网上线并公布合约地址",
    measurement: "截止日前链上存在目标合约地址，且团队公告可交叉验证",
    evidence: "部署交易、合约地址、GitHub release、公告链接",
    defaultStakeEth: "2",
    defaultDeadlineMinutes: "45",
    expectedKeptEvidence: "目标合约地址已部署且公告一致",
    expectedBreachedEvidence: "截止时没有可验证主网合约地址",
  },
  {
    id: "l3-policy",
    tier: "L3",
    category: "Public Accountability",
    title: "Public service metric",
    goal: "任期内公共服务满意度从 65% 提升到 80%",
    measurement: "同一统计口径下，公开数据源显示指标 >= 80%",
    evidence: "政府公开数据、第三方审计报告、媒体事实核查",
    defaultStakeEth: "3",
    defaultDeadlineMinutes: "60",
    expectedKeptEvidence: "两个公开数据源确认指标达到 80%",
    expectedBreachedEvidence: "审计数据确认指标停留在 72%",
  },
];

export function scenarioById(id: string): DemoScenarioTemplate {
  const scenario = demoScenarioTemplates.find((item) => item.id === id);
  return scenario ?? demoScenarioTemplates[0];
}

export function analyzeGoalForDemo(input: {
  goal: string;
  stakeEth: string;
  scenarioId: string;
}): GoalAnalysis {
  const scenario = scenarioById(input.scenarioId);
  const goal = input.goal.trim();
  const reasons: string[] = [];
  const hasNumber = /(\d+|[一二三四五六七八九十百千万]+)\s*(天|次|公里|%|季度|Q[1-4]|月|年|日|ETH|个)?/i.test(goal);
  const hasDeadline = /(截止|之前|前|内|Q[1-4]|季度|任期|天|月|年|日)/i.test(goal);
  const hasEvidence = hasObjectiveEvidencePath(goal, scenario);
  const stake = Number(input.stakeEth);

  if (!goal) reasons.push("目标不能为空");
  if (!Number.isFinite(stake) || stake <= 0) reasons.push("质押金额必须大于 0");
  if (!hasNumber) reasons.push("目标缺少可量化数字");
  if (!hasDeadline) reasons.push("目标缺少明确到期时间");
  if (!hasEvidence) reasons.push("目标缺少客观证据来源");

  return {
    accepted: reasons.length === 0,
    score: Math.max(0, 100 - reasons.length * 24),
    reasons: reasons.length ? reasons : ["目标可量化、可到期判断、证据来源明确"],
    normalizedGoal: goal || scenario.goal,
    tier: scenario.tier,
    category: scenario.category,
    quantifier: inferQuantifier(goal || scenario.goal),
    deadline: inferDeadline(goal || scenario.goal, scenario.defaultDeadlineMinutes),
    evidenceSource: scenario.evidence,
  };
}

export function compileDemoPredicate(scenario: DemoScenarioTemplate): DemoPredicate {
  if (scenario.id === "l1-habit") {
    return {
      goal: scenario.goal,
      tier: scenario.tier,
      predType: PredType.HABIT,
      paramsBlob: abi.encode(["uint16", "string"], [24, "daily"]) as Hex,
      paramsSummary: "HABIT(requiredCheckins=24, cadence=daily)",
    };
  }

  if (scenario.id === "l2-delivery") {
    const target = deterministicAddress(`demo-target:${scenario.goal}`);
    return {
      goal: scenario.goal,
      tier: scenario.tier,
      predType: PredType.ONCHAIN_MILESTONE,
      paramsBlob: abi.encode(["address"], [target]) as Hex,
      paramsSummary: `ONCHAIN_MILESTONE(target=${target})`,
    };
  }

  return {
    goal: scenario.goal,
    tier: scenario.tier,
    predType: PredType.POLICY,
    paramsBlob: abi.encode(["string", "string"], [scenario.measurement, "multi_source_public_records"]) as Hex,
    paramsSummary: "POLICY(metric=80%, source=multi_source_public_records)",
  };
}

export function eligibleReviewVoters(input: {
  subject: Hex;
  participants: readonly DemoParticipant[];
  relatedParties: readonly Hex[];
  tokenHolders: readonly Hex[];
}): ReviewVoter[] {
  const subject = normalize(input.subject);
  const participantSet = new Set(input.participants.map((participant) => normalize(participant.address)));
  const relatedSet = new Set(input.relatedParties.map((address) => normalize(address)));

  return input.tokenHolders.map((address) => {
    const normalized = normalize(address);
    if (participantSet.has(normalized)) {
      return { address, eligible: false, reason: "已参与该市场" };
    }
    if (relatedSet.has(normalized)) {
      return { address, eligible: false, reason: "关联方隔离" };
    }
    if (normalized === subject) {
      return { address, eligible: false, reason: "发起人隔离" };
    }
    return { address, eligible: true, reason: "可投票" };
  });
}

export function buildDemoResolution(input: {
  scenario: DemoScenarioTemplate;
  oracleOutcome: Outcome.Kept | Outcome.Breached;
  agentOutcomes: Array<Outcome.Kept | Outcome.Breached>;
  participants: readonly DemoParticipant[];
  relatedParties: readonly Hex[];
  reviewVoters?: ReviewVoter[];
}): DemoResolution {
  const agentConsensus = majorityOutcome(input.agentOutcomes);
  const needsHumanReview = agentConsensus !== input.oracleOutcome;
  const finalOutcome = needsHumanReview ? agentConsensus : input.oracleOutcome;
  const winnerSide = finalOutcome === Outcome.Kept ? Side.Commit : Side.Skeptic;
  const timeline: ResolutionTimelineStep[] = [
    {
      label: "Oracle proposal",
      detail: "Inspired by Polymarket UMA: proposer posts an outcome and bond after expiry.",
    },
  ];

  if (needsHumanReview) {
    timeline.push(
      {
        label: "Multi-agent disagreement",
        detail: "Verifier agents disagree with the oracle proposal, so the case leaves optimistic settlement.",
      },
      {
        label: "Token-holder review",
        detail: "Eligible token holders vote after excluding the creator, participants, and related parties.",
      },
    );
  } else {
    timeline.push({
      label: "Challenge window",
      detail: "No dispute in the demo challenge window, so the oracle proposal can finalize.",
    });
  }

  timeline.push({
    label: "Final settlement",
    detail:
      finalOutcome === Outcome.Kept
        ? "Commit side wins, subject bond returns, loser pool feeds rewards and insurance."
        : "Skeptic side wins, subject bond and commit pool are split across winners, community, and insurance.",
  });

  return {
    oracleOutcome: input.oracleOutcome,
    agentOutcomes: input.agentOutcomes,
    agentConsensus,
    needsHumanReview,
    finalOutcome,
    reviewVoters: input.reviewVoters ?? [],
    timeline,
    distribution:
      finalOutcome === Outcome.Kept
        ? {
            winnerSide,
            winnerReceives: "Commit stakers reclaim stake plus 80% of Skeptic pool; subject bond is returned.",
            protocolBuckets: "Remaining Skeptic pool goes to insurance treasury.",
          }
        : {
            winnerSide,
            winnerReceives: "Skeptic stakers reclaim stake plus winner reward bucket.",
            protocolBuckets: "Subject bond and Commit pool fund community and insurance buckets.",
          },
  };
}

function majorityOutcome(outcomes: Array<Outcome.Kept | Outcome.Breached>): Outcome.Kept | Outcome.Breached {
  const kept = outcomes.filter((outcome) => outcome === Outcome.Kept).length;
  return kept > outcomes.length / 2 ? Outcome.Kept : Outcome.Breached;
}

function inferQuantifier(goal: string): string {
  const match = goal.match(/(\d+\s*(?:天|次|公里|%|个|月|年)?)/i);
  return match?.[1] ?? "未识别";
}

function inferDeadline(goal: string, defaultDeadlineMinutes: string): string {
  const match = goal.match(/(Q[1-4]|任期内|\d+\s*(?:天|月|年)内|截止日前)/i);
  return match?.[1] ?? `${defaultDeadlineMinutes} 分钟 demo 到期`;
}

function hasObjectiveEvidencePath(goal: string, scenario: DemoScenarioTemplate): boolean {
  if (/(打卡|GPS|截图|地址|合约|公开|数据|审计|报告|公告|链上|source|evidence)/i.test(goal)) {
    return true;
  }

  if (scenario.id === "l1-habit") {
    return /(晨跑|跑步|公里|km|运动|check-?in)/i.test(goal);
  }

  if (scenario.id === "l2-delivery") {
    return /(主网|上线|合约|部署|地址|release|mainnet)/i.test(goal);
  }

  return /(满意度|指标|提升|%|百分比|公共服务|任期)/i.test(goal);
}

function deterministicAddress(seed: string): Hex {
  const hash = keccak256(toUtf8Bytes(seed));
  return getAddress(`0x${hash.slice(-40)}`).toLowerCase() as Hex;
}

function normalize(address: string): string {
  if (!isAddress(address)) {
    return String(address).toLowerCase();
  }
  return getAddress(address).toLowerCase();
}
