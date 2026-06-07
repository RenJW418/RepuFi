// Lightweight bilingual (zh/en) i18n — no external deps.
export type Lang = "zh" | "en";

export interface Bi {
  zh: string;
  en: string;
}

// Pick a localized string
export function L(b: Bi, lang: Lang): string {
  return b[lang];
}

// ── UI string dictionary ──
export const T = {
  // Topbar
  newPact: { zh: "新建事件", en: "New Pact" },
  credibility: { zh: "信誉档案", en: "Credibility" },
  connect: { zh: "连接钱包", en: "Connect" },
  refreshMarkets: { zh: "刷新市场", en: "Refresh markets" },

  // Hero
  eyebrow: { zh: "ETH Beijing 演示控制台", en: "Beijing ETH demo console" },
  heroTitle: { zh: "用链上市场为承诺风险定价", en: "Price commitment risk with on-chain markets." },
  heroSub: {
    zh: "发起一个承诺事件，让守约方与怀疑方的资金为违约概率定价，到期后将结果沉淀为链上信誉档案。",
    en: "Create a pact, let Commit and Skeptic capital price the breach probability, then resolve outcomes into a credibility profile.",
  },
  refresh: { zh: "刷新", en: "Refresh" },
  currentMarket: { zh: "当前市场", en: "Current market" },
  sampleMarket: { zh: "示例市场", en: "Sample market" },
  demo: { zh: "演示", en: "Demo" },
  metricMarkets: { zh: "市场数", en: "Markets" },
  metricBreachOdds: { zh: "违约赔率", en: "Breach odds" },
  metricLiquidity: { zh: "流动性", en: "Liquidity" },
  stepConnect: { zh: "连接", en: "Connect" },
  stepCreateStake: { zh: "立约 / 下注", en: "Create / Stake" },
  stepTradeOdds: { zh: "交易赔率", en: "Trade Odds" },
  stepResolve: { zh: "结算", en: "Resolve" },

  // Guide
  guideConnectLabel: { zh: "连接钱包", en: "Connect Wallet" },
  guideConnectHint: { zh: "先连接钱包以开始。", en: "Link a wallet to begin." },
  guideCreateLabel: { zh: "创建第一个事件", en: "Create the First Pact" },
  guideCreateHint: { zh: "还没有市场——发起一个承诺事件。", en: "No markets yet — launch a commitment quest." },
  guidePickLabel: { zh: "选择一个市场", en: "Pick a Market" },
  guidePickHint: { zh: "从列表中选择一个事件来交易。", en: "Choose a quest from the board to trade." },
  guideStakeLabel: { zh: "下注一个立场", en: "Stake a Position" },
  guideStakeHint: { zh: "押守约（Commit）或违约（Skeptic）。", en: "Back Commit (kept) or Skeptic (breach)." },
  guideResolveLabel: { zh: "结算并铸造信誉", en: "Resolve & Earn Credibility" },
  guideResolveHint: { zh: "结算事件并更新信誉 SBT。", en: "Settle the pact and update the SBT." },

  // Section
  liveMarkets: { zh: "实时市场", en: "Live Markets" },

  // Create panel
  createPact: { zh: "创建承诺事件", en: "Create Pact" },
  goalLabel: { zh: "承诺目标（自然语言）", en: "Commitment goal (natural language)" },
  goalPlaceholder: { zh: "例如：Q3 结束前完成主网上线并公布合约地址", en: "e.g. launch mainnet and publish contract by Q3" },
  scenario: { zh: "场景类型", en: "Scenario" },
  scenarioL2: { zh: "L2 项目交付", en: "L2 Project delivery" },
  scenarioL1: { zh: "L1 个人习惯", en: "L1 Personal habit" },
  scenarioL3: { zh: "L3 公众问责", en: "L3 Public accountability" },
  stakeAmount: { zh: "质押金额", en: "Stake amount" },
  reviewWithBrain: { zh: "用 Brain Agent 审查", en: "Review with Brain Agent" },
  analyzing: { zh: "分析中…", en: "Analyzing…" },
  goalApproved: { zh: "✓ 目标已通过", en: "✓ Goal approved" },
  goalRejected: { zh: "✗ 目标被拒绝", en: "✗ Goal rejected" },
  brainSuggests: { zh: "Brain 建议改为：", en: "Brain suggests:" },
  adoptSuggestion: { zh: "采用此建议", en: "Adopt suggestion" },
  milestoneTarget: { zh: "里程碑目标地址", en: "Milestone target address" },
  deadlineMin: { zh: "截止（分钟）", en: "Deadline (min)" },
  listQuest: { zh: "发布事件", en: "List Quest" },
  createHint: {
    zh: "发起者质押保证金。Commit 押守约，Skeptic 为违约风险定价。",
    en: "Subject stakes the bond. Commit backs delivery. Skeptic prices breach risk.",
  },

  // Markets panel
  markets: { zh: "市场", en: "Markets" },
  catAll: { zh: "全部", en: "All" },
  catL1: { zh: "L1 习惯", en: "L1 Habit" },
  catL2: { zh: "L2 交付", en: "L2 Delivery" },
  catL3: { zh: "L3 公众", en: "L3 Policy" },
  featured: { zh: "最热门", en: "Featured" },
  moreMarkets: { zh: "更多市场", en: "More Markets" },
  createReal: { zh: "创建真实事件", en: "Create a Real Pact" },
  commit: { zh: "守约", en: "Commit" },
  skeptic: { zh: "违约", en: "Skeptic" },
  vol: { zh: "成交量", en: "Vol." },
  unverified: { zh: "未认证", en: "Unverified" },
  breach: { zh: "违约", en: "breach" },

  // Detail panel
  oddsSettlement: { zh: "赔率与结算", en: "Odds & Settlement" },
  impliedBreach: { zh: "隐含违约概率", en: "Implied breach probability" },
  sampleBreach: { zh: "示例违约概率", en: "Sample breach probability" },
  outcomePending: { zh: "进行中", en: "Pending" },
  outcomeKept: { zh: "守约", en: "Kept" },
  outcomeBreached: { zh: "违约", en: "Breached" },
  tradeHint: { zh: "点击下注，钱包将弹出确认质押金额", en: "Click to bet — your wallet will prompt for the stake" },
  factSubject: { zh: "发起者", en: "Subject" },
  factBond: { zh: "保证金", en: "Bond" },
  factCommitPool: { zh: "守约池", en: "Commit Pool" },
  factSkepticPool: { zh: "违约池", en: "Skeptic Pool" },
  creatorIdentity: { zh: "发起者身份", en: "Creator Identity" },
  edit: { zh: "编辑", en: "Edit" },
  linkPlus: { zh: "+ 关联", en: "+ Link" },
  linkVerifyTitle: { zh: "关联 / 验证身份", en: "Link / verify identity" },
  noXLinked: { zh: "未关联 𝕏", en: "No 𝕏 linked" },
  kycPassed: { zh: "KYC ✓ 已通过", en: "KYC ✓ Passed" },
  kycNot: { zh: "KYC ✗ 未验证", en: "KYC ✗ Not verified" },
  noIdentity: { zh: "尚未关联身份。关联 𝕏 或完成 KYC 以建立信任。", en: "No identity linked. Link 𝕏 or complete KYC to build trust." },
  resolve: { zh: "结算", en: "Resolve" },
  claim: { zh: "领取", en: "Claim" },
  resolutionPipeline: { zh: "裁决流程（UMA + 多 Agent + 人工复核）", en: "Resolution Pipeline (UMA + Multi-Agent + Human Review)" },
  umaStepTitle: { zh: "UMA 乐观预言机", en: "UMA Optimistic Oracle" },
  umaStepBody: { zh: "提案者提交结果并质押保证金（0.1 ETH），进入争议窗口。", en: "Proposer posts outcome + bond (0.1 ETH). Liveness window opens." },
  agentStepTitle: { zh: "多 Agent 交叉核验", en: "Multi-Agent Cross-Check" },
  agentStepBody: { zh: "3 个独立 Brain Agent 核验证据。若与 UMA 不一致则按多数覆盖。", en: "3 independent Brain agents verify evidence. Majority overrides if they disagree with UMA." },
  humanStepTitle: { zh: "人工复核（DVM）", en: "Human Review (DVM)" },
  humanStepBody: { zh: "有争议的结果交由代币持有者投票，并执行利益隔离。", en: "Disputed outcomes go to token-holder vote. Interest isolation applied." },
  voterEligibility: { zh: "复核投票资格", en: "Review Voter Eligibility" },
  eligible: { zh: "可投票", en: "eligible" },
  close: { zh: "关闭", en: "Close" },
  createLiveMarket: { zh: "创建真实市场", en: "Create Live Market" },

  // Profile panel
  credibilityCard: { zh: "信誉档案卡", en: "Credibility Card" },
  subjectAddress: { zh: "发起者地址", en: "Subject address" },
  loadProfile: { zh: "加载档案", en: "Load Profile" },
  score: { zh: "信誉分", en: "Score" },
  kept: { zh: "守约次数", en: "Kept" },
  broken: { zh: "违约次数", en: "Broken" },
  stakedKept: { zh: "守约质押", en: "Staked Kept" },
  profileHint: { zh: "选择一个市场或粘贴发起者地址，查看其 SBT 信誉记录。", en: "Select a market or paste a subject address to inspect its SBT record." },

  // Identity modal
  linkIdentity: { zh: "关联身份", en: "Link Identity" },
  identityModalSub: {
    zh: "关联你的 𝕏 账号或完成 KYC，建立与市场参与者的信任。身份信息会展示给查看此市场的其他用户。",
    en: "Link your 𝕏 account or KYC to build trust with market participants. Identity is shown to other users when they view this market.",
  },
  xHandle: { zh: "𝕏（Twitter）账号", en: "𝕏 (Twitter) handle" },
  kycVerification: { zh: "KYC 认证", en: "KYC Verification" },
  kycComingSoon: { zh: "完整 KYC 即将上线。演示时点击下方按钮模拟。", en: "Full KYC coming soon. For demo, click Simulate." },
  linkX: { zh: "关联 𝕏", en: "Link 𝕏" },
  simulateKyc: { zh: "模拟 KYC ✓", en: "Simulate KYC ✓" },
  identityModalHint: {
    zh: "与事件存在利益关系的参与方将被排除在人工复核投票之外。身份信息有助于执行利益隔离规则。",
    en: "Participants with conflicts of interest are excluded from the human review vote. Your identity helps enforce interest isolation rules.",
  },

  // Bet modal
  backCommit: { zh: "押注守约", en: "Back Commit" },
  backSkeptic: { zh: "押注违约", en: "Back Skeptic" },
  thinkKept: { zh: "你认为 TA 会守约", en: "You think they will keep it" },
  thinkBreach: { zh: "你认为 TA 会违约", en: "You think they will breach" },
  perShare: { zh: "/ 份", en: "/ share" },
  betAmountLabel: { zh: "质押金额 (ETH)", en: "Stake amount (ETH)" },
  estShares: { zh: "预计份额", en: "Est. shares" },
  winReturn: { zh: "赢则可得", en: "If you win" },
  currentPrice: { zh: "当前价格", en: "Current price" },
  confirmBet: { zh: "确认下注", en: "Confirm bet" },
  walletConfirming: { zh: "钱包确认中…", en: "Confirming in wallet…" },
  betHint: { zh: "点击后钱包（MetaMask）将弹出，请在钱包中确认这笔链上质押交易。", en: "Your wallet (MetaMask) will prompt you to confirm this on-chain stake." },

  // Status messages
  msgReady: { zh: "就绪。启动本地链、部署后刷新市场。", en: "Ready. Start local chain, deploy, then refresh markets." },
  msgNoMarkets: { zh: "暂无市场，创建一个事件开始吧。", en: "No markets yet. Create a pact to start." },
  msgResolverChecking: { zh: "裁决器正在核验里程碑…", en: "Resolver checking milestone..." },
  msgMarketResolved: { zh: "市场已结算。", en: "Market resolved." },
  msgClaimPending: { zh: "领取交易提交中…", en: "Claim transaction pending..." },
  msgRewardClaimed: { zh: "奖励已领取。", en: "Reward claimed." },
  msgSelectFirst: { zh: "请先选择一个市场。", en: "Select a market first." },
  msgBackingCommit: { zh: "正在押注守约方…", en: "Backing Commit side..." },
  msgBackingSkeptic: { zh: "正在押注违约方…", en: "Backing Skeptic side..." },
  msgPositionConfirmed: { zh: "下注已上链确认。", en: "Position confirmed on-chain." },
  msgEnterGoal: { zh: "请先输入目标。", en: "Enter a goal first." },
  msgBrainRejected: { zh: "Brain 拒绝了该目标——见下方建议。", en: "Brain rejected — see suggestions below." },
  msgBrainUnavailable: { zh: "Brain API 不可用——请手动填写里程碑目标。", en: "Brain API unavailable — fill milestone target manually." },
  msgMintingQuest: { zh: "正在铸造承诺事件…", en: "Minting commitment quest..." },
  msgQuestListed: { zh: "事件已发布到市场。", en: "Quest listed on the market board." },
  msgXLinked: { zh: "𝕏 身份已关联。", en: "𝕏 identity linked." },
  msgKycSimulated: { zh: "已模拟 KYC 通过。", en: "KYC simulated as passed." },

  // xAPI integration
  xapiBind: { zh: "绑定 xAPI", en: "Bind xAPI" },
  xapiModalTitle: { zh: "绑定 xAPI · 社交曝光引擎", en: "Bind xAPI · Social Reach Engine" },
  xapiIntro: {
    zh: "xAPI 是一个聚合社交媒体与 AI 模型的 API 平台（Twitter/X、抖音、Reddit、微博、AI 模型等）。绑定后，RepuFi 可以用它把你新发布的事件一键推送到社交平台，扩大曝光，并调用 AI 模型自动生成推文文案。",
    en: "xAPI aggregates social-media and AI-model APIs (Twitter/X, Douyin, Reddit, Weibo, LLMs). Once bound, RepuFi can one-click publish your new pacts to social platforms for maximum reach, and use its models to auto-draft post copy.",
  },
  xapiOfficial: { zh: "访问 xAPI 官网", en: "Visit xAPI website" },
  xapiKeyLabel: { zh: "xAPI API Key", en: "xAPI API Key" },
  xapiKeyPlaceholder: { zh: "sk-…（在 xapi.to 注册获取）", en: "sk-… (get one at xapi.to)" },
  xapiSave: { zh: "保存 Key", en: "Save Key" },
  xapiSaved: { zh: "xAPI Key 已保存。", en: "xAPI Key saved." },
  xapiConfigured: { zh: "已绑定", en: "Bound" },
  xapiNotConfigured: { zh: "未绑定", en: "Not bound" },
  xapiHint: {
    zh: "Key 仅保存在本地浏览器，用于调用 xAPI 的社交发布与模型接口。",
    en: "Key is stored locally in your browser, used to call xAPI social-publish and model endpoints.",
  },

  // Social announce (after creating a pact / on a market)
  shareToSocial: { zh: "一键发布到社交平台", en: "Share to social" },
  sharing: { zh: "发布中…", en: "Sharing…" },
  shareDraftTitle: { zh: "AI 生成的推文文案", en: "AI-drafted post" },
  sharePublished: { zh: "已发布到 𝕏！", en: "Published to 𝕏!" },
  shareViewPost: { zh: "查看推文", en: "View post" },
  shareNeedKey: { zh: "请先绑定 xAPI Key。", en: "Bind your xAPI key first." },
  shareNeedBinding: { zh: "发布失败：xAPI 账号未绑定社交平台或余额不足。", en: "Publish failed: no social binding or insufficient xAPI balance." },
  shareModelUsed: { zh: "文案模型", en: "Drafted by" },
} as const;

export type TKey = keyof typeof T;
