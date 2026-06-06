import type { BrainLlm } from "../../llm/mock.js";
import type { Tier } from "../../shared/schemas.js";

export interface GoalValidationResult {
  valid: boolean;
  goal: string;
  tier: Tier;
  reason: string;
  suggestions: string[];
}

const QUANTIFIABLE_PATTERNS = [
  /\d+\s*天/,
  /\d+\s*日/,
  /Q[1-4]/i,
  /\d{4}年/,
  /\d+月/,
  /\d+\s*%/,
  /增长|减少|提升|降低/,
  /上线|部署|发布/,
  /主网|测试网/,
  /ETH|BTC|USDC|TVL/i,
];

const VAGUE_PATTERNS = [
  /变得更/,
  /努力/,
  /尽量/,
  /争取/,
  /希望/,
  /可能/,
];

export function validateGoalLocally(goal: string, tier: Tier): GoalValidationResult {
  const hasQuantifiable = QUANTIFIABLE_PATTERNS.some((p) => p.test(goal));
  const isVague = VAGUE_PATTERNS.some((p) => p.test(goal));

  if (isVague && !hasQuantifiable) {
    return {
      valid: false,
      goal,
      tier,
      reason: "目标缺乏可量化指标，无法客观判断是否达成。",
      suggestions: [
        "加入具体数字：完成次数、百分比、金额",
        "加入明确截止日期：Q3、30天、2026年底",
        "加入可验证事件：合约部署、链上记录、公开数据",
      ],
    };
  }

  if (goal.trim().length < 5) {
    return {
      valid: false,
      goal,
      tier,
      reason: "目标描述过短，无法解析意图。",
      suggestions: ["请详细描述你的承诺内容"],
    };
  }

  const tierSuggestions: Record<Tier, string> = {
    L1: "L1 个人自律目标建议包含频率（每天/每周）和持续时长（30天）",
    L2: "L2 项目方目标建议包含交付里程碑和链上可验证事件",
    L3: "L3 公众人物目标建议包含具体指标基准值和目标值",
  };

  return {
    valid: true,
    goal,
    tier,
    reason: "目标包含可量化指标，可生成谓词并上链。",
    suggestions: [tierSuggestions[tier]],
  };
}

export async function validateGoal(input: {
  goal: string;
  tier: Tier;
  llm?: BrainLlm;
}): Promise<GoalValidationResult> {
  const local = validateGoalLocally(input.goal, input.tier);

  if (!input.llm) {
    return local;
  }

  const response = await input.llm.completeStructured({
    task: "validate-goal",
    goal: input.goal,
    tier: input.tier,
  });

  const llmValid = response.valid !== false;
  const llmReason = typeof response.reason === "string" ? response.reason : local.reason;
  const llmSuggestions = Array.isArray(response.suggestions)
    ? (response.suggestions as string[])
    : local.suggestions;

  return {
    valid: local.valid && llmValid,
    goal: input.goal,
    tier: input.tier,
    reason: llmReason,
    suggestions: llmSuggestions,
  };
}
