/**
 * 三条 case 完整端到端演示
 *
 * L1 — 个人自律：30天养成晨跑
 * L2 — 项目方交付：Q3主网上线
 * L3 — 公众人物施政：任期内GDP增长3%
 *
 * 每条 case 演示：
 *   目标量化审查 → 质押创建 → 广场展示 → 怀疑方定价下注 →
 *   到期裁决（多Agent + UMA + 人工复核备用）→ 结算 → 信誉更新
 */
import { pathToFileURL } from "node:url";
import { Wallet } from "ethers";

import { createLedger } from "../agents/base/ledger.js";
import { compilePredicate } from "../agents/predicate/compile.js";
import { resolveOutcome } from "../agents/resolver/index.js";
import type { TokenHolder } from "../agents/resolver/humanReview.js";
import { decideAndPlaceBet } from "../agents/skeptic/bet.js";
import { extractPricingFeatures } from "../agents/skeptic/features.js";
import { priceBreachProbability } from "../agents/skeptic/price.js";
import { validateGoal } from "../agents/validator/goalValidator.js";
import { verifyHabitEvidence } from "../agents/verifier/habit.js";
import { verifyOnchainMilestone } from "../agents/verifier/onchain.js";
import { verifyPolicyEvidence } from "../agents/verifier/policy.js";
import { signVerdict } from "../agents/verifier/sign.js";
import { createMockLlm } from "../llm/mock.js";
import { deterministicAddress } from "../llm/mock.js";
import { Outcome, PredType, type Hex } from "../shared/schemas.js";

const VERIFIER_KEY =
  "0x59c6995e998f97a5a004497e5da8e8d40188335a8e5c08c7871a7464a26d70d5";

const MOCK_TOKEN_HOLDERS: TokenHolder[] = [
  { address: "0xA000000000000000000000000000000000000001" as Hex, balance: 1000n },
  { address: "0xA000000000000000000000000000000000000002" as Hex, balance: 500n },
  { address: "0xA000000000000000000000000000000000000003" as Hex, balance: 750n },
  { address: "0xA000000000000000000000000000000000000004" as Hex, balance: 200n },
  { address: "0xA000000000000000000000000000000000000005" as Hex, balance: 300n },
];

function separator(title: string) {
  console.log("\n" + "═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function step(label: string, data?: unknown) {
  console.log(`\n▶ ${label}`);
  if (data !== undefined) {
    console.log(
      JSON.stringify(
        data,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
  }
}

// ─── Case L1: 个人自律 ─────────────────────────────────────────────────────

async function runCaseL1(kept: boolean) {
  separator(`Case L1 — 个人自律 (${kept ? "守约✓" : "违约✗"})`);
  const llm = createMockLlm();
  const ledger = createLedger({ mode: "mock" });
  const verifierWallet = new Wallet(VERIFIER_KEY);
  const subject = "0x1100000000000000000000000000000000000001" as Hex;

  // 1. 目标量化审查
  const goal = "30天养成晨跑";
  const validation = await validateGoal({ goal, tier: "L1", llm });
  step("目标量化审查", validation);
  if (!validation.valid) throw new Error("目标未通过量化审查");

  // 2. 编译谓词 → 质押创建
  const predicate = await compilePredicate({ goal, tier: "L1", llm });
  step("谓词编译", { predType: predicate.predType, params: predicate.params, rationale: predicate.rationale });

  const pact = await ledger.createPact({
    subject,
    predType: predicate.predType,
    paramsBlob: predicate.paramsBlob,
    deadline: Math.floor(Date.now() / 1000) + 30 * 86400,
    bond: 500_000_000_000_000_000n,
  });
  step("广场发布 — 承诺已创建", { pactId: pact.pactId });

  // 3. 怀疑方定价下注
  const profile = await ledger.getProfile(subject);
  const pHat = priceBreachProbability(extractPricingFeatures(profile));
  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability: pHat,
    edge: 0.05,
    amount: 50_000_000_000_000_000n,
  });
  step("怀疑方 Agent 定价下注", { modelBreachProbability: pHat, bet });

  // 4. 到期裁决 (L1 habit — AI 判打卡证据)
  if (predicate.params.kind !== "habit_checkin") throw new Error("Expected habit predicate");
  const completedCheckins = kept ? predicate.params.requiredDays : Math.floor(predicate.params.requiredDays * 0.5);
  const verification = await verifyHabitEvidence({
    pactId: pact.pactId,
    completedCheckins,
    requiredCheckins: predicate.params.requiredDays,
  });
  step("打卡证据裁判", { completedCheckins, required: predicate.params.requiredDays, outcome: Outcome[verification.outcome] });

  // 多Agent + 裁决协同（L1 无需UMA，直接多Agent）
  const resolution = await resolveOutcome({
    pactId: pact.pactId,
    goal,
    subject,
    participants: [],
    evidence: { completedCheckins, requiredCheckins: predicate.params.requiredDays },
    primaryOutcome: verification.outcome,
    llm,
    tokenHolders: MOCK_TOKEN_HOLDERS,
  });
  step("裁决协同结果", { source: resolution.source, conflict: resolution.conflict, detail: resolution.detail });

  // 5. 签名 + 提交裁决
  const verdict = await signVerdict({
    wallet: verifierWallet,
    pactId: pact.pactId,
    outcome: verification.outcome,
    evidenceHash: verification.evidenceHash,
  });
  const settlement = await ledger.submitVerdict(verdict);
  const updated = await ledger.getProfile(subject);

  step("结算 + 信誉更新", {
    outcome: Outcome[settlement.outcome],
    score: updated.score.toString(),
    kept: updated.kept,
    broken: updated.broken,
    permanentStain: updated.permanentStain,
  });
}

// ─── Case L2: 项目方交付 ───────────────────────────────────────────────────

async function runCaseL2(kept: boolean) {
  separator(`Case L2 — 项目方交付 (${kept ? "守约✓" : "违约✗"})`);
  const llm = createMockLlm();
  const ledger = createLedger({ mode: "mock" });
  const verifierWallet = new Wallet(VERIFIER_KEY);
  const subject = "0x2200000000000000000000000000000000000002" as Hex;

  const goal = "Q3主网上线";
  const validation = await validateGoal({ goal, tier: "L2", llm });
  step("目标量化审查", validation);

  const predicate = await compilePredicate({ goal, tier: "L2", llm });
  step("谓词编译", { predType: predicate.predType, params: predicate.params });

  const pact = await ledger.createPact({
    subject,
    predType: predicate.predType,
    paramsBlob: predicate.paramsBlob,
    deadline: Math.floor(Date.now() / 1000) + 90 * 86400,
    bond: 10_000_000_000_000_000_000n,
  });
  step("广场发布 — 承诺已创建", { pactId: pact.pactId });

  const profile = await ledger.getProfile(subject);
  const pHat = priceBreachProbability(extractPricingFeatures(profile));
  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability: pHat,
    edge: 0.05,
    amount: 1_000_000_000_000_000_000n,
  });
  step("怀疑方 Agent 定价下注", { modelBreachProbability: pHat, bet });

  // L2 确定性链上裁判
  if (predicate.params.kind !== "contract_deployed") throw new Error("Expected onchain predicate");
  const target = predicate.params.target;
  const deployedAddresses = kept ? [target] : [];
  const verification = await verifyOnchainMilestone({
    pactId: pact.pactId,
    target,
    chainState: { deployedAddresses },
  });
  step("链上里程碑裁判 (确定性)", { target, deployed: kept, outcome: Outcome[verification.outcome] });

  // 裁决协同（L2: UMA + 多Agent）
  const resolution = await resolveOutcome({
    pactId: pact.pactId,
    goal,
    subject,
    participants: [bet.placed ? ("0x9900000000000000000000000000000000000001" as Hex) : subject],
    evidence: { deployedAddresses },
    primaryOutcome: verification.outcome,
    llm,
    tokenHolders: MOCK_TOKEN_HOLDERS,
    simulateUmaDispute: false,
  });
  step("裁决协同结果", { source: resolution.source, conflict: resolution.conflict, detail: resolution.detail });

  const verdict = await signVerdict({
    wallet: verifierWallet,
    pactId: pact.pactId,
    outcome: verification.outcome,
    evidenceHash: verification.evidenceHash,
  });
  const settlement = await ledger.submitVerdict(verdict);
  const updated = await ledger.getProfile(subject);

  step("结算 + 信誉更新", {
    outcome: Outcome[settlement.outcome],
    score: updated.score.toString(),
    kept: updated.kept,
    broken: updated.broken,
  });
}

// ─── Case L3: 公众人物施政 ─────────────────────────────────────────────────

async function runCaseL3(kept: boolean, withConflict = false) {
  separator(`Case L3 — 公众人物施政 (${kept ? "守约✓" : "违约✗"}${withConflict ? " + 争议升级" : ""})`);
  const llm = createMockLlm();
  const ledger = createLedger({ mode: "mock" });
  const verifierWallet = new Wallet(VERIFIER_KEY);
  const subject = "0x3300000000000000000000000000000000000003" as Hex;

  const goal = "任期内GDP增长3%";
  const validation = await validateGoal({ goal, tier: "L3", llm });
  step("目标量化审查", validation);

  const predicate = await compilePredicate({ goal, tier: "L3", llm });
  step("谓词编译", { predType: predicate.predType, params: predicate.params });

  const pact = await ledger.createPact({
    subject,
    predType: predicate.predType,
    paramsBlob: predicate.paramsBlob,
    deadline: Math.floor(Date.now() / 1000) + 4 * 365 * 86400,
    bond: 100_000_000_000_000_000_000n,
  });
  step("广场发布 — 承诺已创建", { pactId: pact.pactId });

  const profile = await ledger.getProfile(subject);
  const pHat = priceBreachProbability(extractPricingFeatures(profile));
  const bet = await decideAndPlaceBet({
    ledger,
    pactId: pact.pactId,
    modelBreachProbability: pHat,
    edge: 0.05,
    amount: 5_000_000_000_000_000_000n,
  });
  step("怀疑方 Agent 定价下注", { modelBreachProbability: pHat, bet });

  // L3 多源取证裁判
  const positiveSources = kept ? ["official_gdp_report_2027", "world_bank_data"] : [];
  const negativeSources = kept ? [] : ["official_gdp_report_2027_negative", "imf_report_contraction"];
  const verification = await verifyPolicyEvidence({
    pactId: pact.pactId,
    positiveSources,
    negativeSources,
  });
  step("多源取证 + LLM 综合裁判", { positiveSources, negativeSources, outcome: Outcome[verification.outcome] });

  // 裁决协同（L3: 可能触发争议 → 人工复核 + 利益隔离）
  const resolution = await resolveOutcome({
    pactId: pact.pactId,
    goal,
    subject,
    participants: bet.placed ? ["0x9900000000000000000000000000000000000001" as Hex] : [],
    evidence: { positiveSources, negativeSources },
    primaryOutcome: verification.outcome,
    llm,
    tokenHolders: MOCK_TOKEN_HOLDERS,
    simulateUmaDispute: withConflict,
  });
  step("裁决协同结果", {
    source: resolution.source,
    conflict: resolution.conflict,
    outcome: Outcome[resolution.outcome],
    detail: resolution.detail,
  });

  const verdict = await signVerdict({
    wallet: verifierWallet,
    pactId: pact.pactId,
    outcome: resolution.outcome,
    evidenceHash: resolution.evidenceHash,
  });
  const settlement = await ledger.submitVerdict(verdict);
  const updated = await ledger.getProfile(subject);

  step("结算 + 信誉更新", {
    outcome: Outcome[settlement.outcome],
    score: updated.score.toString(),
    kept: updated.kept,
    broken: updated.broken,
    permanentStain: updated.permanentStain,
  });
}

// ─── 入口 ──────────────────────────────────────────────────────────────────

export async function runAllCases() {
  console.log("\n🏛  PACT Brain — 三条 Case 完整演示\n");

  await runCaseL1(true);    // L1 守约
  await runCaseL1(false);   // L1 违约
  await runCaseL2(true);    // L2 守约
  await runCaseL2(false);   // L2 违约
  await runCaseL3(true);    // L3 守约
  await runCaseL3(false);   // L3 违约
  await runCaseL3(false, true); // L3 违约 + 争议升级 → 人工复核

  console.log("\n\n✅  所有 Case 演示完成\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAllCases().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
