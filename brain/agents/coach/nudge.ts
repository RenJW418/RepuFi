export interface CoachNudgeInput {
  goal: string;
  currentStreak: number;
  blockers: string[];
}

export interface CoachNudge {
  goal: string;
  actions: string[];
  risk: "low" | "medium" | "high";
}

export function createCoachNudge(input: CoachNudgeInput): CoachNudge {
  const blockerText = input.blockers.length > 0 ? `，避开阻力：${input.blockers.join("、")}` : "";
  const risk = input.currentStreak === 0 ? "high" : input.currentStreak < 7 ? "medium" : "low";

  return {
    goal: input.goal,
    risk,
    actions: [
      `今天完成一次${input.goal}${blockerText}`,
      `把下一次行动压缩到 10 分钟，并在完成后提交打卡证据`,
      `连续 ${input.currentStreak + 1} 天后再提高难度，不提前加码`,
    ],
  };
}
