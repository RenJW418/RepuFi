# RepuFi Ledger

RepuFi 模块一 Ledger 的当前目录落地版本。它实现链上承诺市场、parimutuel 双边池、Resolver 裁决入口、自验证里程碑适配器，以及不可转移的 Credibility SBT。

## 已实现

- `PactMarket`: 合约生成 `pactId` 和 `predicateHash`，支持立约、Commit/Skeptic 下注、违约概率定价、结算、领奖。
- `CredibilitySBT`: 每个 subject 一份不可转移信誉档案，守约按 `bond * difficulty` 加分，违约扣分并累计永久污点。
- `Resolver`: 支持授权 verifier 的 EIP-191 签名裁决，也支持 `selfResolve` 走自验证 adapter。
- `OnchainMilestoneAdapter`: MVP 自验证谓词，判断目标地址是否已部署合约。
- `shared/schemas.ts`: 与 Brain 拼接的枚举和共享类型单一真源。
- `scripts/seedDemo.ts`: 不依赖 Brain，直接跑守约/违约两条路径。

## 命令

```bash
npm install
npm run compile
npm test
npm run demo
```

本地节点部署：

```bash
npx hardhat node
npm run deploy
```

部署脚本会写入：
- `shared/addresses.json`
- `shared/abis/*.json`

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
