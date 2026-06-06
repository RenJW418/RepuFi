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
}

export function reviewGoalIntake(input: GoalIntakeInput): GoalIntakeDecision {
  const analysis = analyzeGoalForDemo(input);
  if (!analysis.accepted) {
    return { accepted: false, analysis };
  }
  return {
    accepted: true,
    analysis,
    predicate: compileDemoPredicate(scenarioById(input.scenarioId)),
  };
}
