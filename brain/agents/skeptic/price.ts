import type { PricingFeatures } from "./features.js";

export function priceBreachProbability(features: PricingFeatures): number {
  const sparseHistoryPenalty = features.total === 0 ? 0.3 : 0;
  const stainPenalty = features.permanentStain ? 0.2 : 0;
  const raw =
    0.28 +
    sparseHistoryPenalty +
    features.brokenRatio * 0.48 -
    features.keptRatio * 0.12 -
    features.scoreSignal * 0.1 +
    stainPenalty;

  return clamp(raw, 0.03, 0.97);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
