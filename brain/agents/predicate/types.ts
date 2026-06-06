import type { Hex, PredType, Tier } from "../../shared/schemas.js";

export interface OnchainMilestoneParams {
  kind: "contract_deployed";
  target: Hex;
}

export interface HabitParams {
  kind: "habit_checkin";
  requiredDays: number;
  cadence: "daily";
}

export interface PolicyParams {
  kind: "policy_metric";
  metric: string;
  sourcePolicy: string;
}

export type PredicateParams = OnchainMilestoneParams | HabitParams | PolicyParams;

export interface PredicateSpec {
  goal: string;
  tier: Tier;
  predType: PredType;
  params: PredicateParams;
  paramsBlob: Hex;
  rationale: string;
}
