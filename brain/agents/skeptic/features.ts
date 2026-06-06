import type { CredibilityProfile } from "../../shared/schemas.js";

export interface PricingFeatures {
  kept: number;
  broken: number;
  total: number;
  brokenRatio: number;
  keptRatio: number;
  scoreSignal: number;
  permanentStain: boolean;
}

export function extractPricingFeatures(profile: CredibilityProfile): PricingFeatures {
  const total = profile.kept + profile.broken;
  return {
    kept: profile.kept,
    broken: profile.broken,
    total,
    brokenRatio: total === 0 ? 0 : profile.broken / total,
    keptRatio: total === 0 ? 0 : profile.kept / total,
    scoreSignal: scoreToSignal(profile.score),
    permanentStain: profile.permanentStain,
  };
}

function scoreToSignal(score: bigint): number {
  const bounded = Math.max(-10_000, Math.min(10_000, Number(score / 1_000_000_000_000_000n)));
  return bounded / 10_000;
}
