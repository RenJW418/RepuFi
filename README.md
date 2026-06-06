# RepuFi

RepuFi is split into two module folders:

- `ledger/`: module one, on-chain commitment market, settlement, credibility SBT, and frontend.
- `brain/`: module two, agent predicate compilation, pricing, verification, coaching, and Ledger integration.

The Ledger module implements chain-hosted commitment markets, parimutuel pools, the Resolver boundary, on-chain milestone self-resolution, and non-transferable Credibility SBT profiles.

## 已实现

- `ledger/contracts/PactMarket.sol`: 合约生成 `pactId` 和 `predicateHash`，支持立约、Commit/Skeptic 下注、违约概率定价、结算、领奖。
- `ledger/contracts/CredibilitySBT.sol`: 每个 subject 一份不可转移信誉档案，守约按 `bond * difficulty` 加分，违约扣分并累计永久污点。
- `ledger/contracts/Resolver.sol`: 支持授权 verifier 的 EIP-191 签名裁决，也支持 `selfResolve` 走自验证 adapter。
- `ledger/contracts/Resolver.sol`: 当 oracle 结果和多 Agent consensus 不一致时，可开启链上 token-holder review；发起人、市场参与者、关联方会被合约拒绝投票。
- `ledger/contracts/RepuToken.sol`: 本地 demo 用的 REPU review token；`Resolver.voteReview` 要求投票钱包持有 REPU。
- `ledger/contracts/adapters/OnchainMilestoneAdapter.sol`: MVP 自验证谓词，判断目标地址是否已部署合约。
- `ledger/shared/schemas.ts`: 与 Brain 拼接的枚举和共享类型单一真源。
- `ledger/shared/demoWorkflow.ts`: 三类 demo case 的目标审查、predicate 编译、分类、UMA/多 Agent/人工复核展示模型。
- `ledger/frontend/`: 从目标输入、Agent 审查、发布广场、分类筛选、下注、裁决、领取到信誉档案的演示工作台。
- `brain/agents/intake/review.ts` 和 `brain/agents/intake/server.ts`: 后台 Agent intake 入口和 HTTP API；网站通过 `POST /api/intake/review` 审查目标，拒绝宽泛目标，只有可量化、到期可判断、有客观证据路径的目标才会返回可发布 predicate。
- `ledger/scripts/seedDemo.ts`: 不依赖 Brain，直接跑守约/违约两条路径。
- `ledger/scripts/demoScenarios.ts`: 三类 MD 场景的链上 smoke，逐个创建、下注、签名裁决、领奖。

## 命令

```bash
npm run setup
npm run compile
npm test
npm run demo
npm run ledger:demo:scenarios
npm run ledger:frontend:build
npm run brain:intake
npm run brain:selfcheck
npm run brain:scenarios
```

本地节点部署：

```bash
npm run node
npm run deploy
npm run ledger:seed:plaza
npm run brain:intake
npm run frontend:dev
```

部署脚本会写入：
- `ledger/shared/addresses.json`
- `ledger/shared/abis/*.json`

## 三类 case 演示流程

1. 启动本地链并部署：

```bash
npm run node
npm run deploy
```

2. 预置当前部署的广场数据。

```bash
npm run ledger:seed:plaza
```

`ledger:seed:plaza` 会把 L1 个人纪律、L2 项目交付、L3 公共问责三类场景发布到当前 `ledger/shared/addresses.json` 指向的本地链合约，并各自放入 Commit/Skeptic 流动性。

3. 启动 Brain 后台 Agent intake API：

```bash
npm run brain:intake
```

默认监听 `http://127.0.0.1:8790/api/intake/review`。网页会用 `VITE_BRAIN_API_URL` 调这个接口；未设置时默认 `http://127.0.0.1:8790`。

4. 打开网站：

```bash
npm run frontend:dev
```

网页第一屏就是工作台：

- `Goal intake`: 用户选择三类 case，输入目标和质押金额；网页调用 Brain 后台 Agent 审查，Agent 只接受可量化、到期可判断、有客观证据路径的目标，并把通过的 predicate 返回给钱包发布流程。
- `Wallet`: 顶栏可连接真实浏览器钱包，也可直接选择 Hardhat 本地 demo 钱包：`Local subject` 发布事件，`Local Commit bettor` / `Local Skeptic bettor` 下注，`Local REPU reviewer` 持有 REPU 且未参与市场，可演示人工复核投票。
- `Plaza`: 事件发布后进入广场，可按 `Personal Discipline`、`Project Delivery`、`Public Accountability` 筛选。
- `Market detail`: 用户进入事件后选择 Commit/Skeptic 和金额，通过钱包下注。
- `Resolution demo`: 参考 Polymarket/UMA 乐观预言机：oracle proposal、challenge window；当多 Agent consensus 与 oracle 不一致时，调用 `Resolver.submitDisputedVerdict` 开启链上 token-holder review。
- `Vote review`: 持有 REPU 且非参与者/非发起人/非关联方的钱包可调用 `Resolver.voteReview`；无 REPU、发起人、Commit/Skeptic 参与者、关联方会被合约拒绝。部署脚本会给本地 Hardhat `reviewer` 钱包铸 100 REPU。
- `Submit verifier verdict`: oracle 和 Agent 一致时，用本地部署的授权 verifier 钱包签名提交裁决，最终走 `Resolver.submitVerdict` 上链结算。
- `Claim` 和 `Credibility`: 赢家领取收益，subject 的 CredibilitySBT 档案更新。

5. 无浏览器 smoke：

```bash
npm run ledger:demo:scenarios
npm run brain:scenarios
```

`ledger:demo:scenarios` 证明 L1/L2/L3 都能在合约上创建、下注、裁决、领取；其中 L3 走 oracle/Agent 分歧后的链上 token-holder review 再结算。`brain:scenarios` 证明 L1/L2/L3 的 kept/breach 六条 Brain mock 路径都能编译 predicate、下注、验真、签名、结算。

`brain:selfcheck` 额外证明后台 Agent intake 会拒绝“我要变得更好”这类宽泛目标，并接受 L1/L2/L3 三类 demo 目标后返回 HABIT、ONCHAIN_MILESTONE、POLICY 三种可发布 predicate。

当前 demo 没有接真实 UMA 主网/测试网；网页和 `Resolver` 按官方 Polymarket/UMA 文档映射乐观预言机、争议升级和代币持有人投票流程，本地链用授权 verifier 打开裁决或争议，再由 `Resolver` 完成资金结算。

## 关键接口

- Brain 下注：`PactMarket.takePosition(pactId, side)`，金额放在 `msg.value`。
- Brain 裁决：`Resolver.submitVerdict(pactId, outcome, evidenceHash, sig)`。
- 自验证裁决：`Resolver.selfResolve(pactId, predType, paramsBlob)`。
- 读价格：`PactMarket.impliedBreachProb(pactId)`，返回 bps，默认 5000。
- 读信誉：`CredibilitySBT.getProfile(subject)`。

## 奖池分配

守约 `Kept`：

```text
subject 拿回 100% bond
Commit 赢家拿回本金 + 80% Skeptic 输家池
20% Skeptic 输家池进入 insuranceTreasury
```

违约 `Breached`：

```text
Skeptic 赢家拿回本金 + 70% Commit 输家池 + 40% bond
50% bond 进入 communityTreasury
30% Commit 输家池 + 10% bond 进入 insuranceTreasury
```

这让市场不再是简单赢家通吃：赢家被奖励，受影响社区获得赔付，协议持续积累公共信誉保险池。

签名口径固定为：

```text
digest = keccak256(abi.encode(pactId, uint8(outcome), evidenceHash))
sig = personal_sign(digest)
```
