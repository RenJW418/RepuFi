import {
  analyzeGoalForDemo,
  compileDemoPredicate,
  scenarioById,
  type DemoPredicate,
  type GoalAnalysis,
} from "../../shared/demoWorkflow.js";

export interface GoalIntakeInput {
  goal: string;
  stakeEth: string;
  scenarioId: string;
}

export interface GoalIntakeDecision {
  accepted: boolean;
  analysis: GoalAnalysis;
  predicate?: DemoPredicate;
  /** LLM-suggested rewrite of the goal (always provided so user can choose to adopt) */
  rewrittenGoal?: string;
}

export function reviewGoalIntake(input: GoalIntakeInput): GoalIntakeDecision {
  const analysis = analyzeGoalForDemo(input);
  const scenario = scenarioById(input.scenarioId);

  // Build a deterministic rewritten goal suggestion based on the scenario template
  const rewrittenGoal = analysis.accepted
    ? undefined // valid goals don't need rewriting
    : buildRewrittenSuggestion(input.goal, scenario.goal, scenario.tier);

  if (!analysis.accepted) {
    return { accepted: false, analysis, rewrittenGoal };
  }
  return {
    accepted: true,
    analysis,
    predicate: compileDemoPredicate(scenario),
    rewrittenGoal,
  };
}

function buildRewrittenSuggestion(
  original: string,
  templateGoal: string,
  tier: string,
): string {
  // Use the original as context prefix, then append a quantified form based on tier
  const core = original.trim().slice(0, 20);
  if (tier === "L1") {
    return `30天内完成"${core}"相关行动，每日打卡，共计30次有效记录`;
  }
  if (tier === "L2") {
    return `Q3结束前完成"${core}"并在链上公布可验证合约地址`;
  }
  return `任期内将"${core}"相关指标提升至可量化目标值，以第三方公开数据为准`;
}

