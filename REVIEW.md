# PACT 方案 Review

## 结论

按方案一落地。方案一 Ledger 是资金、市场、信誉档案和前端可见性的权威层，边界清晰，可独立跑通 create -> takePosition -> resolve -> claim -> credibility update 的闭环。方案二 Brain 依赖 Ledger 的地址、ABI、事件和信誉档案，在当前目标下应作为后续拼接对象，而不是先实现主体。

## 对方案一的 Review

优点：
- MVP 闭环完整：立约、下注、parimutuel 定价、结算、领奖、信誉更新都在链上可验证。
- 与 Brain 的耦合窄：只暴露 `takePosition`、`submitVerdict`、读视图和事件，Brain 没完成也能用脚本扮演裁判。
- 反赌博叙事有链上证据：信誉分与 subject 自己的 bond 和市场难度绑定，收益是守约后的可信度溢价。
- L2 自验证路径可不依赖预言机，适合 hackathon 现场稳定 demo。

主要风险与处理：
- 签名口径容易不一致：实现固定为 `keccak256(abi.encode(pactId, uint8(outcome), evidenceHash))` + EIP-191 `personal_sign`。
- `predicateHash` 不能 A/B 各算：实现由合约根据 `predType + paramsBlob` 统一计算。
- 违约 bond 去向需要明确：当前违约时 bond 拆分给 Skeptic 赢家、communityTreasury 和 insuranceTreasury，不再简单赢家通吃。
- 信誉口径需要稳定：守约加分使用 `bond * closeProbBps / 10000`，违约按 bond 扣分并永久增加 `broken`。

## 对方案二的 Review

方案二适合作为拼接层：负责谓词编译、做市 agent、裁判 agent、教练 agent。它的价值依赖方案一已经有稳定的 `shared/`、ABI 和事件。当前如果先做 Brain mock，容易产生“看起来有 agent 但没有链上闭环”的风险，所以不作为本轮落地主线。

## 本轮落地范围

在当前目录根下实现方案一，不写入 `调研/`：
- Hardhat + TypeScript 工程。
- `PactMarket`、`CredibilitySBT`、`Resolver`、`OnchainMilestoneAdapter`。
- `shared/schemas.ts`、`shared/addresses.json`、ABI 导出目录。
- 单测覆盖价格、结算、资金守恒、SBT 不可转移、签名裁决、自验证。
- `scripts/deploy.ts` 和 `scripts/seedDemo.ts` 用于本地部署与独立 demo。

## 二次审计结论

模块一 MVP 已真正落地，证据如下：
- 合约闭环：`createPact -> takePosition -> selfResolve/submitVerdict -> claim -> CredibilitySBT.onSettle` 已实现并测试。
- 共享接口：`shared/schemas.ts`、`shared/addresses.json`、`shared/abis/*.json` 已由部署脚本维护。
- 自验证路径：`OnchainMilestoneAdapter` 可按 `paramsBlob` 读取目标地址代码状态；`Resolver.selfResolve` 会校验 `predicateHash`，且未到期不能提前把缺失里程碑判为违约。
- 非自验证路径：`Resolver.submitVerdict` 使用 EIP-191 签名恢复授权 verifier。
- 资金边界：多赢家领取时最后一个赢家吃掉整数除法 dust，最终合约余额归零。
- 前端：`frontend/` 从 `shared/` 读取 ABI/地址，提供创建、市场列表、单 pact 详情、价格历史点、下注、selfResolve、claim 和信誉档案。
- 奖池分配：守约时 80% 输家池给 Commit、20% 进保险池；违约时 70% Commit + 40% bond 给 Skeptic、50% bond 给社区、30% Commit + 10% bond 给保险池。

已验证命令：
- `npm run compile`
- `npm test`，当前 11 条测试通过
- `npm run demo`
- `npm run frontend:build`
- `npm run deploy`，会刷新 `shared/addresses.json` 和 `shared/abis/`

未落地但属于方案中可选或后续范围：
- USDC/ERC20 版与 `MockUSDC`，当前按方案 MVP 使用 ETH。
- 测试网部署，当前完成本地链部署导出。
- Next.js/wagmi/Tailwind 的指定技术栈，当前用 Vite React + ethers 实现同等功能面。
- 独立的多页面路由与组件拆分，当前是单页工具型前端，但覆盖市场广场、创建、单 pact、信誉档案四类视图。
