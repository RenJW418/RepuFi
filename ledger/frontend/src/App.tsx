import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Brain,
  CircleDollarSign,
  Flag,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Target,
  Trophy,
  UserRound,
  Wallet,
  X
} from "lucide-react";
import { AbiCoder, ZeroAddress, formatEther, parseEther } from "ethers";
import {
  getReadContracts,
  getWriteContracts,
  loadPactCreated,
  loadPriceHistory,
  loadReviewVoters,
  Pact,
  PactRow,
  PricePoint,
  ReviewVoterRow
} from "./contracts";
import { T, type Lang } from "./i18n";
import "./styles.css";

const OUTCOMES_BI = [
  { zh: "进行中", en: "Pending" },
  { zh: "守约", en: "Kept" },
  { zh: "违约", en: "Breached" },
];
const PRED_LABELS: Record<number, string> = { 1: "L2 Delivery", 2: "Outflow", 3: "L1 Habit", 4: "L3 Policy" };
const PRED_TIER: Record<number, "L1" | "L2" | "L3"> = { 1: "L2", 2: "L2", 3: "L1", 4: "L3" };
const ONCHAIN_MILESTONE = 1;
const BRAIN_API_URL = import.meta.env.VITE_BRAIN_API_URL ?? "http://127.0.0.1:8790";

interface Identity {
  address: string;
  twitterHandle?: string;
  twitterVerified: boolean;
  kycPassed: boolean;
  displayName?: string;
}

function cardTitle(row: PactRow, lang: Lang, identity?: Identity): string {
  const name = identity?.displayName ?? identity?.twitterHandle ?? short(row.subject);
  if (lang === "zh") {
    if (row.predType === 1) return `${name} 能否按时部署里程碑合约？`;
    if (row.predType === 3) return `${name} 能否完成 30 天习惯打卡？`;
    if (row.predType === 4) return `${name} 能否达成公开政策承诺目标？`;
    return `${name} 能否兑现此承诺？`;
  }
  if (row.predType === 1) return `Will ${name} deploy the milestone contract on time?`;
  if (row.predType === 3) return `Will ${name} complete the 30-day habit streak?`;
  if (row.predType === 4) return `Will ${name} meet the public policy commitment target?`;
  return `Will ${name} fulfil this commitment?`;
}

// Anchor captured once when the app bundle loads — synthetic demo deadlines
// are offset from this so the on-chain demo cards show a live countdown even
// though their real on-chain deadlines (seeded with short windows) have passed.
const APP_LOADED = Math.floor(Date.now() / 1000);

function timeLeft(deadline: number, lang: Lang, nowSec?: number): string {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  let diff = deadline - now;
  if (diff <= 0) return lang === "zh" ? "已截止" : "Expired";
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(diff / 86400); diff -= d * 86400;
  const h = Math.floor(diff / 3600); diff -= h * 3600;
  const m = Math.floor(diff / 60);
  const s = diff - m * 60;
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

type BrainReview = {
  accepted: boolean;
  reasons: string[];
  predType: number;
  paramsBlob: string;
  paramsSummary: string;
  tier: string;
  rewrittenGoal?: string;
} | null;

type Profile = {
  score: bigint;
  kept: bigint;
  broken: bigint;
  stakedKept: bigint;
  updated: bigint;
};

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function pct(bps: bigint | number) {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function eth(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function milestoneTarget(paramsBlob: string) {
  try {
    return AbiCoder.defaultAbiCoder().decode(["address"], paramsBlob)[0] as string;
  } catch {
    return ZeroAddress;
  }
}

function outcomeClass(outcome?: bigint) {
  if (outcome === 1n) return "kept";
  if (outcome === 2n) return "breached";
  return "pending";
}

const SAMPLE_MARKETS = [
  // ─── 最热门：三个具名 demo（视频演示用，已部署到 Sepolia）───
  {
    id: "l1-habit",
    tier: "L1 Habit",
    featured: true,
    title: {
      zh: "姚帅能否做到连续 30 天早睡早起（每天 23:00 前睡、7:00 前起）？",
      en: "Will Yao Shuai keep a 30-day early-sleep streak (bed by 23:00, up by 7:00)?",
    },
    deadline: "30d",
    odds: "37%",
    bond: "2.5",
    volume: "12.4 ETH",
    currency: "ETH",
    author: "@yaoshuai",
    displayName: { zh: "姚帅", en: "Yao Shuai" },
    kyc: true,
    twitterVerified: true,
  },
  {
    id: "l2-delivery",
    tier: "L2 Delivery",
    featured: true,
    title: {
      zh: "RepuFi 项目方能否在 Q3（7/1–9/30）前完成主网上线并公布合约地址？",
      en: "Will the RepuFi team ship mainnet and publish the contract by Q3 (Jul 1 – Sep 30)?",
    },
    deadline: "92d",
    odds: "52%",
    bond: "25",
    volume: "86.7 ETH",
    currency: "ETH",
    author: "@RepuFi_team",
    displayName: { zh: "RepuFi 项目方", en: "RepuFi Team" },
    kyc: true,
    twitterVerified: true,
  },
  {
    id: "l3-policy",
    tier: "L3 Policy",
    featured: true,
    title: {
      zh: "特朗普能否兑现中期选举承诺：任内将通胀率降至 3% 以下？",
      en: "Will Trump fulfil his midterm pledge to bring inflation below 3% in office?",
    },
    deadline: "180d",
    odds: "61%",
    bond: "500,000",
    volume: "2,480,000 USDC",
    currency: "USDC",
    author: "@realDonaldTrump",
    displayName: { zh: "Donald Trump", en: "Donald Trump" },
    kyc: true,
    twitterVerified: true,
  },
  // ─── 其他展示例子（比赛展示用，不部署到链上）───
  {
    id: "demo-l1-fitness",
    tier: "L1 Habit",
    featured: false,
    title: {
      zh: "健身博主能否完成 90 天打卡挑战（每周至少 4 练）？",
      en: "Will the fitness creator finish a 90-day challenge (4+ sessions/week)?",
    },
    deadline: "90d",
    odds: "44%",
    bond: "1.8",
    volume: "5.2 ETH",
    currency: "ETH",
    author: "@fit_chen",
    displayName: { zh: "陈教练", en: "Coach Chen" },
    kyc: false,
    twitterVerified: true,
  },
  {
    id: "demo-l2-token",
    tier: "L2 Delivery",
    featured: false,
    title: {
      zh: "某 DeFi 协议能否在年底前实现 TVL 突破 1 亿美元？",
      en: "Will a DeFi protocol break $100M TVL before year-end?",
    },
    deadline: "200d",
    odds: "73%",
    bond: "80,000",
    volume: "420,000 USDC",
    currency: "USDC",
    author: "@defi_lab",
    displayName: { zh: "DeFi Lab", en: "DeFi Lab" },
    kyc: true,
    twitterVerified: false,
  },
  {
    id: "demo-l3-mayor",
    tier: "L3 Policy",
    featured: false,
    title: {
      zh: "某市长能否兑现任内新增 5000 个公租房名额的承诺？",
      en: "Will the mayor deliver 5,000 new public-housing units in their term?",
    },
    deadline: "365d",
    odds: "48%",
    bond: "150,000",
    volume: "680,000 USDC",
    currency: "USDC",
    author: "@city_gov",
    displayName: { zh: "市政公开账号", en: "City Gov" },
    kyc: true,
    twitterVerified: true,
  },
];

const SAMPLE_ODDS = [18, 28, 24, 37, 34, 44, 39, 52, 46, 38.75];

// On-chain demo pact metadata (keyed by Sepolia pactId from seedPlaza).
// Lets the three live demo markets render with named titles + identity instead
// of the generic "0x30e3..." subject, so the recorded demo shows a full loop.
interface DemoMeta {
  title: { zh: string; en: string };
  displayName: { zh: string; en: string };
  author: string;
  currency: "ETH" | "USDC";
  kyc: boolean;
  twitterVerified: boolean;
  breachPct: number;   // varied per market so gauges differ
  volume: string;      // realistic-looking total staked volume
  // Synthetic deadline offset (seconds from app load). Negative = already
  // expired (used to demo settlement). The real on-chain deadlines were
  // seeded with short windows and have long passed, so the card uses this.
  deadlineOffsetSec: number;
}
const DEMO_META: Record<string, DemoMeta> = {
  "0xccea0049fab57856ae539239a6b2de008de6d52c03b5e479bf7f368ed46592d0": {
    title: {
      zh: "姚帅能否做到连续 30 天早睡早起（每天 23:00 前睡、7:00 前起）？",
      en: "Will Yao Shuai keep a 30-day early-sleep streak (bed by 23:00, up by 7:00)?",
    },
    displayName: { zh: "姚帅", en: "Yao Shuai" },
    author: "@yaoshuai",
    currency: "ETH",
    kyc: true,
    twitterVerified: true,
    breachPct: 37,
    volume: "12.4 ETH",
    deadlineOffsetSec: 18 * 86400 + 6 * 3600 + 42 * 60, // ~18d live countdown
  },
  "0xef8f3f831467b77112d1e571ced156bd4a50d4a8444b411a26a1e1d7014d309b": {
    title: {
      zh: "RepuFi 项目方能否在 Q3（7/1–9/30）前完成主网上线并公布合约地址？",
      en: "Will the RepuFi team ship mainnet and publish the contract by Q3 (Jul 1 – Sep 30)?",
    },
    displayName: { zh: "RepuFi 项目方", en: "RepuFi Team" },
    author: "@RepuFi_team",
    currency: "ETH",
    kyc: true,
    twitterVerified: true,
    breachPct: 52,
    volume: "86.7 ETH",
    deadlineOffsetSec: 73 * 86400 + 3 * 3600 + 15 * 60, // ~73d live countdown
  },
  "0x0a9df538d952ba4e0ab02fb11767a4213f56c065a2a5308ee42cab7832e5aacb": {
    title: {
      zh: "特朗普能否兑现中期选举承诺：任内将通胀率降至 3% 以下？",
      en: "Will Trump fulfil his midterm pledge to bring inflation below 3% in office?",
    },
    displayName: { zh: "Donald Trump", en: "Donald Trump" },
    author: "@realDonaldTrump",
    currency: "USDC",
    kyc: true,
    twitterVerified: true,
    breachPct: 61,
    volume: "2,480,000 USDC",
    deadlineOffsetSec: -3600, // already expired → demo settlement flow
  },
};

// Polymarket-style circular probability gauge (shows YES = kept probability)
function ProbGauge({ breachPct, keptLabel }: { breachPct: number; keptLabel: string }) {
  const keptPct = Math.max(0, Math.min(100, 100 - breachPct));
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (keptPct / 100) * circ;
  return (
    <div className="prob-gauge" aria-label={`${keptPct.toFixed(0)}% chance kept`}>
      <svg viewBox="0 0 56 56" width="56" height="56">
        <circle cx="28" cy="28" r={r} className="pg-track" />
        <circle
          cx="28"
          cy="28"
          r={r}
          className="pg-fill"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <div className="pg-label">
        <strong>{keptPct.toFixed(0)}%</strong>
        <span>{keptLabel}</span>
      </div>
    </div>
  );
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`}>
      {children}
    </div>
  );
}

function App() {
  // Language (persisted)
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("repufi-lang") as Lang) || "zh");
  const t = (key: keyof typeof T) => T[key][lang];
  const tb = (bi: { zh: string; en: string }) => bi[lang];
  useEffect(() => { localStorage.setItem("repufi-lang", lang); }, [lang]);

  const [account, setAccount] = useState("");
  const [rows, setRows] = useState<PactRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Pact | null>(null);
  const [breachProb, setBreachProb] = useState<bigint>(0n);
  const [profileAddress, setProfileAddress] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [message, setMessage] = useState<{ zh: string; en: string } | null>(T.msgReady);
  const [target, setTarget] = useState(ZeroAddress);
  const [bond, setBond] = useState("1");
  const [bondCurrency, setBondCurrency] = useState<"ETH" | "USDC">("ETH");
  const [stake, setStake] = useState("1");
  const [side, setSide] = useState<0 | 1>(0);
  const [deadlineMinutes, setDeadlineMinutes] = useState("30");
  const createRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Brain intake integration
  const [goalText, setGoalText] = useState("");
  const [scenarioId, setScenarioId] = useState("l2-delivery");

  // Category filter
  const [activeCategory, setActiveCategory] = useState<"All" | "L1" | "L2" | "L3">("All");

  // Identity store (mock — keyed by address)
  const [identityStore, setIdentityStore] = useState<Record<string, Identity>>({});
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [pendingTwitter, setPendingTwitter] = useState("");
  const [brainReview, setBrainReview] = useState<BrainReview>(null);
  const [brainPending, setBrainPending] = useState(false);

  // Resolution / ReviewVoters
  const [reviewVoters, setReviewVoters] = useState<ReviewVoterRow[]>([]);
  const [showResolution, setShowResolution] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Bet modal (wallet stake dialog)
  const [betModal, setBetModal] = useState<{ pactId: string; side: 0 | 1 } | null>(null);
  const [betAmount, setBetAmount] = useState("0.1");
  const [betPending, setBetPending] = useState(false);

  // Ticking clock (seconds) so countdowns update live
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Per-market breach probability (bps) for card gauges
  const [probMap, setProbMap] = useState<Record<string, number>>({});

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const totalLiquidity = selected ? selected.commitPool + selected.skepticPool + selected.bond : 0n;
  const activeQuest = selected ? (selected.outcome === 0n ? (lang === "zh" ? "交易中" : "Trading") : tb(OUTCOMES_BI[Number(selected.outcome)])) : (lang === "zh" ? "探索" : "Scout");

  // Separate list refresh (slow, full scan) from detail refresh (fast, single pact)
  async function refreshList() {
    const nextRows = await loadPactCreated();
    setRows(nextRows);
    if (!selectedId && nextRows[0]?.id) {
      setSelectedId(nextRows[0].id);
    }
    setMessage(nextRows.length
      ? { zh: `已加载 ${nextRows.length} 个市场。`, en: `${nextRows.length} market${nextRows.length > 1 ? "s" : ""} loaded.` }
      : T.msgNoMarkets);

    // Batch-fetch breach probability for every market so each card can show a gauge
    if (nextRows.length) {
      const { market } = getReadContracts();
      const entries = await Promise.all(
        nextRows.map(async (row) => {
          try {
            const bps = await market.impliedBreachProb(row.id);
            return [row.id, Number(bps)] as const;
          } catch {
            return [row.id, 5000] as const; // default 50%
          }
        }),
      );
      setProbMap(Object.fromEntries(entries));
    }
  }

  async function refreshDetail(id: string) {
    if (!id) { setSelected(null); setBreachProb(0n); setPriceHistory([]); return; }
    setDetailLoading(true);
    try {
      const { market } = getReadContracts();
      const [pact, prob, history] = await Promise.all([
        market.getPact(id),
        market.impliedBreachProb(id),
        loadPriceHistory(id),
      ]);
      setSelected(pact as Pact);
      setBreachProb(prob as bigint);
      setPriceHistory(history);
    } finally {
      setDetailLoading(false);
    }
  }

  // Legacy refresh used by create/resolve/claim (needs both list + detail)
  async function refresh() {
    await refreshList();
    const id = selectedId || rows[0]?.id || "";
    if (id) await refreshDetail(id);
  }

  async function refreshProfile(addr = profileAddress || selected?.subject || account) {
    if (!addr) {
      setMessage({ zh: "未选择发起者地址。", en: "No subject address selected." });
      return;
    }
    const { credibility } = getReadContracts();
    const value = await credibility.profileOf(addr);
    setProfileAddress(addr);
    setProfile(value as Profile);
    setMessage({ zh: `已加载档案 ${short(addr)}。`, en: `Loaded profile ${short(addr)}.` });
  }

  // On mount: load list once, then poll list every 15s (not on every selection change)
  useEffect(() => {
    refreshList().catch((error) => setMessage({ zh: `RPC 离线：${error.shortMessage ?? error.message}`, en: `RPC offline: ${error.shortMessage ?? error.message}` }));
    const interval = window.setInterval(() => {
      refreshList().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When selection changes: only fetch detail for the selected pact (fast — 2 RPC calls)
  useEffect(() => {
    if (selectedId) {
      refreshDetail(selectedId).catch(() => undefined);
    } else {
      setSelected(null); setBreachProb(0n); setPriceHistory([]);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll detail for active (pending) pact every 8s to keep price curve live
  useEffect(() => {
    if (!selectedId) return;
    const interval = window.setInterval(() => {
      refreshDetail(selectedId).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected?.subject) {
      refreshProfile(selected.subject).catch(() => undefined);
    }
  }, [selected?.subject]);

  async function connect() {
    const contracts = await getWriteContracts();
    setAccount(contracts.account);
    setMessage({ zh: `钱包已连接：${short(contracts.account)}。`, en: `Wallet linked: ${short(contracts.account)}.` });
  }

  async function reviewGoal() {
    if (!goalText.trim()) {
      setMessage(T.msgEnterGoal);
      return;
    }
    setBrainPending(true);
    setBrainReview(null);
    try {
      const resp = await fetch(`${BRAIN_API_URL}/api/intake/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goalText, stakeEth: bond, scenarioId }),
      });
      const data = await resp.json() as {
        accepted: boolean;
        rewrittenGoal?: string;
        analysis: { reasons: string[]; tier: string };
        predicate?: { predType: number; paramsBlob: string; paramsSummary: string };
      };
      setBrainReview({
        accepted: data.accepted,
        reasons: data.analysis.reasons,
        tier: data.analysis.tier,
        predType: data.predicate?.predType ?? ONCHAIN_MILESTONE,
        paramsBlob: data.predicate?.paramsBlob ?? "",
        paramsSummary: data.predicate?.paramsSummary ?? "",
        rewrittenGoal: data.rewrittenGoal,
      });
      if (data.accepted && data.predicate?.paramsBlob) {
        try {
          const { AbiCoder: AC } = await import("ethers");
          const decoded = AC.defaultAbiCoder().decode(["address"], data.predicate.paramsBlob);
          setTarget(decoded[0] as string);
        } catch {
          // paramsBlob not an address (L1/L3) — keep existing target
        }
        setMessage({ zh: `Brain 已通过：${data.predicate.paramsSummary}`, en: `Brain approved: ${data.predicate.paramsSummary}` });
      } else {
        setMessage(T.msgBrainRejected);
      }
    } catch {
      setMessage(T.msgBrainUnavailable);
      setBrainReview(null);
    } finally {
      setBrainPending(false);
    }
  }

  async function createPact() {
    const { market } = await getWriteContracts();
    const paramsBlob = AbiCoder.defaultAbiCoder().encode(["address"], [target]);
    const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60;
    const tx = await market.createPact(ONCHAIN_MILESTONE, paramsBlob, BigInt(deadline), { value: parseEther(bond) });
    setMessage(T.msgMintingQuest);
    await tx.wait();
    setMessage(T.msgQuestListed);
    await refresh();
  }

  async function takePosition() {
    if (!selectedId) {
      setMessage(T.msgSelectFirst);
      return;
    }
    const { market } = await getWriteContracts();
    const tx = await market.takePosition(selectedId, side, { value: parseEther(stake) });
    setMessage(side === 0 ? T.msgBackingCommit : T.msgBackingSkeptic);
    await tx.wait();
    setMessage(T.msgPositionConfirmed);
    await refresh();
  }

  // Open the wallet bet dialog for a given market + side (from card or detail)
  function openBetModal(pactId: string, betSide: 0 | 1) {
    setSelectedId(pactId);
    setBetModal({ pactId, side: betSide });
    setBetAmount("0.1");
  }

  // Confirm the bet — prompts wallet, sends takePosition tx
  async function confirmBet() {
    if (!betModal) return;
    setBetPending(true);
    try {
      const { market } = await getWriteContracts();
      const tx = await market.takePosition(betModal.pactId, betModal.side, {
        value: parseEther(betAmount || "0"),
      });
      setMessage(betModal.side === 0 ? T.msgBackingCommit : T.msgBackingSkeptic);
      await tx.wait();
      setMessage(T.msgPositionConfirmed);
      setBetModal(null);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? (err as any).shortMessage ?? err.message : "Transaction failed";
      setMessage({ zh: `下注失败：${msg}`, en: `Bet failed: ${msg}` });
    } finally {
      setBetPending(false);
    }
  }

  async function selfResolve() {
    if (!selectedId || !selectedRow) {
      setMessage(T.msgSelectFirst);
      return;
    }
    const { resolver } = await getWriteContracts();
    const tx = await resolver.selfResolve(selectedId, selectedRow.predType, selectedRow.paramsBlob);
    setMessage(T.msgResolverChecking);
    await tx.wait();
    setMessage(T.msgMarketResolved);
    await refresh();
    await refreshProfile();
    // Load review voters (interest isolation) after resolution
    try {
      const voters = await loadReviewVoters(selectedId);
      setReviewVoters(voters);
      setShowResolution(true);
    } catch {
      setReviewVoters([]);
    }
  }

  async function claim() {
    if (!selectedId) {
      setMessage(T.msgSelectFirst);
      return;
    }
    const { market } = await getWriteContracts();
    const tx = await market.claim(selectedId);
    setMessage(T.msgClaimPending);
    await tx.wait();
    setMessage(T.msgRewardClaimed);
    await refresh();
  }

  function focusPanel(ref: React.RefObject<HTMLDivElement>, key: string, inputId?: string) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(key);
    window.setTimeout(() => setFlash(""), 1200);
    if (inputId) window.setTimeout(() => document.getElementById(inputId)?.focus(), 350);
  }

  function openCreate() {
    setShowCreate(true);
    window.setTimeout(() => focusPanel(createRef, "create", "milestone-input"), 60);
  }

  const connected = Boolean(account);
  const hasMarkets = rows.length > 0;
  const isPending = selected?.outcome === 0n;
  const isResolved = Boolean(selected && selected.outcome !== 0n);
  const traded = selected ? selected.commitPool + selected.skepticPool > 0n : false;
  const previewBreachProb = selected ? Number(breachProb) / 100 : 38.75;
  const previewMarketCount = hasMarkets ? rows.length : SAMPLE_MARKETS.length;
  const previewLiquidity = selected ? `${eth(totalLiquidity)} ETH` : "14.2 ETH";
  const previewQuest = hasMarkets ? activeQuest : t("demo");

  const guide = !connected
    ? { n: 1, label: t("guideConnectLabel"), hint: t("guideConnectHint"), icon: <Wallet size={18} />, action: connect }
    : !hasMarkets
    ? { n: 2, label: t("guideCreateLabel"), hint: t("guideCreateHint"), icon: <Target size={18} />, action: openCreate }
    : !selected
    ? { n: 2, label: t("guidePickLabel"), hint: t("guidePickHint"), icon: <Activity size={18} />, action: () => focusPanel(boardRef, "board") }
    : isPending
    ? { n: 3, label: t("guideStakeLabel"), hint: t("guideStakeHint"), icon: <CircleDollarSign size={18} />, action: () => focusPanel(detailRef, "detail") }
    : { n: 4, label: t("guideResolveLabel"), hint: t("guideResolveHint"), icon: <Flag size={18} />, action: () => focusPanel(detailRef, "detail") };

  const steps = [
    { label: t("stepConnect"), done: connected },
    { label: t("stepCreateStake"), done: hasMarkets },
    { label: t("stepTradeOdds"), done: traded },
    { label: t("stepResolve"), done: isResolved }
  ];

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">RF</span>
          <div>
            <h1>RepuFi</h1>
            <p>{lang === "zh" ? "信誉质押市场与可信度原语" : "Commitment markets and credibility primitives"}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="lang-toggle"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            title="切换语言 / Switch language"
          >
            {lang === "zh" ? "EN" : "中"}
          </button>
          <button onClick={openCreate}><Target size={16} /> {t("newPact")}</button>
          <button className={showProfile ? "toggle-on" : ""} onClick={() => setShowProfile((value) => !value)}><UserRound size={16} /> {t("credibility")}</button>
          <button className="icon-button" onClick={refresh} title={t("refreshMarkets")}>
            <RefreshCcw size={18} />
          </button>
          <button onClick={connect}><Wallet size={16} /> {account ? short(account) : t("connect")}</button>
        </div>
      </header>

      <Reveal className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2 className="hero-title">{t("heroTitle")}</h2>
          <p className="hero-sub">{t("heroSub")}</p>
          <div className="hero-cta-row">
            <button className="cta primary" onClick={guide.action}>{guide.icon} {guide.label}</button>
            <button className="cta secondary" onClick={refresh}><RefreshCcw size={16} /> {t("refresh")}</button>
          </div>
        </div>
        <div className="hero-panel">
          <div className="hero-panel-head">
            <span>{hasMarkets ? t("currentMarket") : t("sampleMarket")}</span>
            <b>{previewQuest}</b>
          </div>
          <div className="risk-meter" aria-label="Breach probability">
            <span style={{ width: `${previewBreachProb}%` }} />
          </div>
          <dl className="hero-metrics">
            <div><dt>{t("metricMarkets")}</dt><dd>{previewMarketCount}</dd></div>
            <div><dt>{t("metricBreachOdds")}</dt><dd>{selected ? pct(breachProb) : "38.75%"}</dd></div>
            <div><dt>{t("metricLiquidity")}</dt><dd>{previewLiquidity}</dd></div>
          </dl>
          <div className="stepper">
            {steps.map((item, index) => (
              <span key={item.label} className={`pip ${item.done ? "done" : ""} ${index === guide.n - 1 ? "active" : ""}`}>
                <i />{item.label}
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      <div className="markets-zone">
      <Reveal className="section-head">
        <h2 className="section-title">{t("liveMarkets")}</h2>
        <span className="section-sub">{guide.hint}</span>
      </Reveal>

      <Reveal className={`grid ${showCreate ? "cols-3" : "cols-2"}`}>
        {showCreate && (
          <div className={`panel create-panel ${flash === "create" ? "flash" : ""}`} ref={createRef}>
            <div className="panel-title">
              <Scale size={18} />
              <h2>{t("createPact")}</h2>
              <button className="icon-button close" onClick={() => setShowCreate(false)} title={t("close")}><X size={16} /></button>
            </div>

            {/* Brain goal intake */}
            <label>
              {t("goalLabel")}
              <input
                id="milestone-input"
                placeholder={t("goalPlaceholder")}
                value={goalText}
                onChange={(e) => { setGoalText(e.target.value); setBrainReview(null); }}
              />
            </label>
            <div className="split">
              <label>
                {t("scenario")}
                <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  <option value="l2-delivery">{t("scenarioL2")}</option>
                  <option value="l1-habit">{t("scenarioL1")}</option>
                  <option value="l3-policy">{t("scenarioL3")}</option>
                </select>
              </label>
              <label>
                {t("stakeAmount")}
                <div className="amount-input">
                  <input value={bond} onChange={(event) => setBond(event.target.value)} />
                  <select value={bondCurrency} onChange={(e) => setBondCurrency(e.target.value as "ETH" | "USDC")}>
                    <option value="ETH">ETH</option>
                    <option value="USDC">USDC</option>
                  </select>
                </div>
              </label>
            </div>
            <button className="wide" onClick={reviewGoal} disabled={brainPending}>
              <Brain size={16} /> {brainPending ? t("analyzing") : t("reviewWithBrain")}
            </button>

            {/* Brain review result */}
            {brainReview && (
              <div className={`brain-result ${brainReview.accepted ? "accepted" : "rejected"}`}>
                {brainReview.accepted ? (
                  <>
                    <strong>{t("goalApproved")}</strong>
                    <small>{brainReview.paramsSummary}</small>
                  </>
                ) : (
                  <>
                    <strong>{t("goalRejected")}</strong>
                    <ul>{brainReview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    {brainReview.rewrittenGoal && (
                      <div className="rewrite-suggestion">
                        <span>{t("brainSuggests")}</span>
                        <em>"{brainReview.rewrittenGoal}"</em>
                        <button
                          className="adopt-btn"
                          onClick={() => {
                            setGoalText(brainReview.rewrittenGoal!);
                            setBrainReview(null);
                          }}
                        >
                          {t("adoptSuggestion")}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <label>
              {t("milestoneTarget")}
              <input value={target} onChange={(event) => setTarget(event.target.value)} />
            </label>
            <label>
              {t("deadlineMin")}
              <input value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
            </label>
            <button
              className="wide primary"
              onClick={createPact}
              disabled={brainReview !== null && !brainReview.accepted}
            >
              <Target size={16} /> {t("listQuest")}
            </button>
            <div className="hint-box">
              {t("createHint")}
            </div>
          </div>
        )}

        <div className={`panel market-list ${flash === "board" ? "flash" : ""}`} ref={boardRef}>
          <div className="panel-title">
            <Activity size={18} />
            <h2>{t("markets")}</h2>
          </div>

          {/* Category filter tabs */}
          <div className="cat-tabs">
            {(["All", "L1", "L2", "L3"] as const).map((cat) => (
              <button
                key={cat}
                className={`cat-tab ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === "All" ? t("catAll") : cat === "L1" ? t("catL1") : cat === "L2" ? t("catL2") : t("catL3")}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="sample-list">
              {(() => {
                const visible = SAMPLE_MARKETS.filter(
                  (m) => activeCategory === "All" || m.tier.startsWith(activeCategory),
                );
                const featured = visible.filter((m) => m.featured);
                const others = visible.filter((m) => !m.featured);

                const renderCard = (market: typeof SAMPLE_MARKETS[number]) => {
                  const breach = parseFloat(market.odds);
                  const name = tb(market.displayName);
                  return (
                    <div key={market.id} className="pm-card sample-row" onClick={openCreate}>
                      <div className="pm-card-top">
                        <div className="pm-icon">{name.slice(0, 2)}</div>
                        <div className="pm-title-wrap">
                          <p className="pm-title">{tb(market.title)}</p>
                          <span className="pm-cat">{market.tier} · {name}</span>
                        </div>
                        <ProbGauge breachPct={breach} keptLabel={t("outcomeKept")} />
                      </div>
                      <div className="pm-actions">
                        <button className="pm-btn commit" onClick={(e) => { e.stopPropagation(); openCreate(); }}>
                          {t("commit")} <b>{(100 - breach).toFixed(0)}¢</b>
                        </button>
                        <button className="pm-btn skeptic" onClick={(e) => { e.stopPropagation(); openCreate(); }}>
                          {t("skeptic")} <b>{breach.toFixed(0)}¢</b>
                        </button>
                      </div>
                      <div className="pm-footer">
                        <span className="pm-vol">{market.volume} {t("vol")}</span>
                        <div className="pm-ids">
                          {market.twitterVerified && <span className="id-badge twitter">𝕏 {market.author}</span>}
                          {market.kyc && <span className="id-badge kyc">KYC ✓</span>}
                          <span className="pm-deadline">{market.deadline}</span>
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    {featured.length > 0 && (
                      <>
                        <div className="section-label"><Trophy size={15} /> {t("featured")}</div>
                        {featured.map(renderCard)}
                      </>
                    )}
                    {others.length > 0 && (
                      <>
                        <div className="section-label">{t("moreMarkets")}</div>
                        {others.map(renderCard)}
                      </>
                    )}
                  </>
                );
              })()}
              <button className="wide primary" onClick={openCreate}><Target size={16} /> Create a Real Pact</button>
            </div>
          ) : null}

          {rows
            .filter((row) => activeCategory === "All" || PRED_TIER[row.predType] === activeCategory)
            .map((row) => {
              const isActive = row.id === selectedId;
              const tier = PRED_LABELS[row.predType] ?? "Commitment";
              const identity = identityStore[row.subject.toLowerCase()];
              const demo = DEMO_META[row.id.toLowerCase()];
              // On-chain prob if traded; else fall back to demo's varied figure so gauges differ
              const onchainProb = probMap[row.id];
              const breach = onchainProb !== undefined && onchainProb !== 5000
                ? onchainProb / 100
                : (demo?.breachPct ?? (onchainProb ?? 5000) / 100);
              const kept = 100 - breach;
              const title = demo ? tb(demo.title) : cardTitle(row, lang, identity);
              const demoName = demo ? tb(demo.displayName) : undefined;
              const iconText = demoName?.slice(0, 2) ?? tier.slice(0, 2);
              const catLabel = demoName ? `${tier} · ${demoName}` : tier;
              const volume = demo?.volume;
              // identity: prefer explicitly linked, else fall back to demo metadata
              const xHandle = identity?.twitterHandle ?? demo?.author?.replace(/^@/, "");
              const xVerified = identity?.twitterVerified ?? demo?.twitterVerified ?? false;
              const kycPassed = identity?.kycPassed ?? demo?.kyc ?? false;
              return (
                <div
                  key={row.id}
                  className={`pm-card ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <div className="pm-card-top">
                    <div className="pm-icon">{iconText}</div>
                    <div className="pm-title-wrap">
                      <p className="pm-title">{title}</p>
                      <span className="pm-cat">{catLabel}</span>
                    </div>
                    <ProbGauge breachPct={breach} keptLabel={t("outcomeKept")} />
                  </div>
                  <div className="pm-actions">
                    <button
                      className="pm-btn commit"
                      onClick={(e) => { e.stopPropagation(); openBetModal(row.id, 0); }}
                    >
                      {t("commit")} <b>{kept.toFixed(0)}¢</b>
                    </button>
                    <button
                      className="pm-btn skeptic"
                      onClick={(e) => { e.stopPropagation(); openBetModal(row.id, 1); }}
                    >
                      {t("skeptic")} <b>{breach.toFixed(0)}¢</b>
                    </button>
                  </div>
                  <div className="pm-footer">
                    <span className="pm-vol">{volume ? `${volume} ${t("vol")}` : `${eth(row.bond)} ETH`}</span>
                    <div className="pm-ids">
                      {xVerified && xHandle
                        ? <span className="id-badge twitter">𝕏 @{xHandle}</span>
                        : <span className="id-badge unverified">{t("unverified")}</span>}
                      {kycPassed && <span className="id-badge kyc">KYC ✓</span>}
                      <span className="pm-deadline">{timeLeft(demo ? APP_LOADED + demo.deadlineOffsetSec : row.deadline, lang, nowSec)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className={`panel detail ${flash === "detail" ? "flash" : ""}`} ref={detailRef}>
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>{t("oddsSettlement")}</h2>
            {detailLoading && <span className="loading-dot" aria-label="Loading…" />}
          </div>
          {selected ? (
            <>
              <div className={`price-band ${outcomeClass(selected.outcome)}`}>
                <div>
                  <span className="label">{t("impliedBreach")}</span>
                  <strong>{pct(breachProb)}</strong>
                </div>
                <span className="outcome-pill">{tb(OUTCOMES_BI[Number(selected.outcome)])}</span>
                <div className="bar">
                  <span style={{ width: `${Number(breachProb) / 100}%` }} />
                </div>
                <div className="sparkline" aria-label="Price history">
                  {(priceHistory.length ? priceHistory : [{ breachProbBps: breachProb } as PricePoint]).map((point, index, arr) => {
                    const left = arr.length === 1 ? 100 : (index / (arr.length - 1)) * 100;
                    const bottom = Number(point.breachProbBps) / 100;
                    return <i key={`${point.blockNumber ?? 0}-${index}`} style={{ left: `${left}%`, bottom: `${bottom}%` }} />;
                  })}
                </div>
              </div>

              <div className="trade-box">
                <button
                  className="side active"
                  onClick={() => openBetModal(selected ? selectedId : "", 0)}
                >
                  <CircleDollarSign size={15} /> {t("commit")}
                </button>
                <button
                  className="side skeptic"
                  onClick={() => openBetModal(selected ? selectedId : "", 1)}
                >
                  <CircleDollarSign size={15} /> {t("skeptic")}
                </button>
                <div className="trade-hint">{t("tradeHint")}</div>
              </div>

              <dl className="facts">
                <div><dt>{t("factSubject")}</dt><dd>{short(selected.subject)}</dd></div>
                <div><dt>{t("factBond")}</dt><dd>{eth(selected.bond)} ETH</dd></div>
                <div><dt>{t("factCommitPool")}</dt><dd>{eth(selected.commitPool)} ETH</dd></div>
                <div><dt>{t("factSkepticPool")}</dt><dd>{eth(selected.skepticPool)} ETH</dd></div>
              </dl>

              {/* Identity card */}
              {(() => {
                const identity = identityStore[selected.subject.toLowerCase()];
                return (
                  <div className="identity-card">
                    <div className="identity-header">
                      <UserRound size={15} />
                      <strong>{t("creatorIdentity")}</strong>
                      <button
                        className="id-link-btn"
                        onClick={() => setShowIdentityModal(true)}
                        title={t("linkVerifyTitle")}
                      >
                        {identity ? t("edit") : t("linkPlus")}
                      </button>
                    </div>
                    {identity ? (
                      <div className="identity-body">
                        {identity.displayName && <span className="id-name">{identity.displayName}</span>}
                        {identity.twitterHandle
                          ? <span className="id-badge twitter">𝕏 {identity.twitterHandle} ✓</span>
                          : <span className="id-badge unverified">{t("noXLinked")}</span>}
                        <span className={`id-badge ${identity.kycPassed ? "kyc" : "unverified"}`}>
                          {identity.kycPassed ? t("kycPassed") : t("kycNot")}
                        </span>
                        <span className="id-addr">{short(selected.subject)}</span>
                      </div>
                    ) : (
                      <p className="id-empty">
                        {t("noIdentity")}
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="actions">
                <button onClick={selfResolve}><Flag size={16} /> {t("resolve")}</button>
                <button onClick={claim}><BadgeCheck size={16} /> {t("claim")}</button>
              </div>

              {/* Resolution pipeline: UMA OO → Multi-Agent → Human Review */}
              {showResolution && (
                <div className="resolution-panel">
                  <div className="resolution-title">
                    <ShieldCheck size={16} />
                    <strong>{t("resolutionPipeline")}</strong>
                  </div>
                  <ol className="resolution-steps">
                    <li>
                      <strong>{t("umaStepTitle")}</strong>
                      <span>{t("umaStepBody")}</span>
                    </li>
                    <li>
                      <strong>{t("agentStepTitle")}</strong>
                      <span>{t("agentStepBody")}</span>
                    </li>
                    <li>
                      <strong>{t("humanStepTitle")}</strong>
                      <span>{t("humanStepBody")}</span>
                    </li>
                  </ol>
                  {reviewVoters.length > 0 && (
                    <div className="voters-section">
                      <strong>{t("voterEligibility")} ({reviewVoters.filter(v => v.eligible).length}/{reviewVoters.length} {t("eligible")})</strong>
                      <div className="voters-list">
                        {reviewVoters.map((v) => (
                          <div key={v.address} className={`voter-row ${v.eligible ? "eligible" : "excluded"}`}>
                            <span className="voter-addr">{short(v.address)}</span>
                            <span className="voter-reason">{v.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="wide" onClick={() => setShowResolution(false)}>
                    <X size={14} /> {t("close")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="sample-detail">
              <div className="price-band sample">
                <div>
                  <span className="label">{t("sampleBreach")}</span>
                  <strong>38.75%</strong>
                </div>
                <span className="outcome-pill">{t("demo")}</span>
                <div className="bar"><span style={{ width: "38.75%" }} /></div>
                <div className="sparkline" aria-label="Sample price history">
                  {SAMPLE_ODDS.map((value, index, arr) => (
                    <i key={index} style={{ left: `${(index / (arr.length - 1)) * 100}%`, bottom: `${value}%` }} />
                  ))}
                </div>
              </div>

              <dl className="facts">
                <div><dt>{t("factSubject")}</dt><dd>0x7A3F...B92C</dd></div>
                <div><dt>{t("factBond")}</dt><dd>2.5 ETH</dd></div>
                <div><dt>{t("factCommitPool")}</dt><dd>8.7 ETH</dd></div>
                <div><dt>{t("factSkepticPool")}</dt><dd>5.5 ETH</dd></div>
              </dl>

              <div className="trade-box disabled-preview" aria-disabled="true">
                <button className="side active">{t("commit")}</button>
                <button className="side">{t("skeptic")}</button>
                <label>
                  {t("stakeAmount")}
                  <input value="1.0" readOnly />
                </label>
                <button className="primary" onClick={openCreate}><Target size={16} /> {t("createLiveMarket")}</button>
              </div>
            </div>
          )}
        </div>

        {showProfile && (
          <div className="panel profile">
            <div className="panel-title">
              <UserRound size={18} />
              <h2>{t("credibilityCard")}</h2>
              <button className="icon-button close" onClick={() => setShowProfile(false)} title={t("close")}><X size={16} /></button>
            </div>
            <label>
              {t("subjectAddress")}
              <input value={profileAddress} onChange={(event) => setProfileAddress(event.target.value)} />
            </label>
            <button className="wide" onClick={() => refreshProfile()}>{t("loadProfile")}</button>
            {profile ? (
              <dl className="facts profile-facts">
                <div><dt>{t("score")}</dt><dd>{eth(profile.score)} ETH</dd></div>
                <div><dt>{t("kept")}</dt><dd>{profile.kept.toString()}</dd></div>
                <div><dt>{t("broken")}</dt><dd>{profile.broken.toString()}</dd></div>
                <div><dt>{t("stakedKept")}</dt><dd>{eth(profile.stakedKept)} ETH</dd></div>
              </dl>
            ) : (
              <div className="hint-box">{t("profileHint")}</div>
            )}
          </div>
        )}
      </Reveal>
      </div>

      {message ? <Reveal className="status">{tb(message)}</Reveal> : null}

      {/* Identity Link Modal */}
      {showIdentityModal && selected && (
        <div className="modal-overlay" onClick={() => setShowIdentityModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <UserRound size={18} />
              <h2>{t("linkIdentity")}</h2>
              <button className="icon-button close" onClick={() => setShowIdentityModal(false)}><X size={16} /></button>
            </div>
            <p className="modal-sub">{t("identityModalSub")}</p>
            <label>
              {t("xHandle")}
              <input
                placeholder="@yourhandle"
                value={pendingTwitter}
                onChange={(e) => setPendingTwitter(e.target.value)}
              />
            </label>
            <div className="modal-kyc-row">
              <span>{t("kycVerification")}</span>
              <span className="hint-text">{t("kycComingSoon")}</span>
            </div>
            <div className="actions">
              <button
                className="primary"
                onClick={() => {
                  const addr = selected.subject.toLowerCase();
                  setIdentityStore((prev) => ({
                    ...prev,
                    [addr]: {
                      address: addr,
                      twitterHandle: pendingTwitter.replace(/^@/, "") || undefined,
                      twitterVerified: Boolean(pendingTwitter),
                      kycPassed: prev[addr]?.kycPassed ?? false,
                    },
                  }));
                  setShowIdentityModal(false);
                  setMessage(T.msgXLinked);
                }}
              >
                <UserRound size={15} /> {t("linkX")}
              </button>
              <button
                onClick={() => {
                  const addr = selected.subject.toLowerCase();
                  setIdentityStore((prev) => ({
                    ...prev,
                    [addr]: {
                      ...(prev[addr] ?? { address: addr, twitterHandle: undefined, twitterVerified: false }),
                      kycPassed: true,
                    },
                  }));
                  setShowIdentityModal(false);
                  setMessage(T.msgKycSimulated);
                }}
              >
                <BadgeCheck size={15} /> {t("simulateKyc")}
              </button>
            </div>
            <div className="hint-box" style={{ marginTop: 12 }}>
              {t("identityModalHint")}
            </div>
          </div>
        </div>
      )}

      {/* Bet (stake) Modal — wallet dialog */}
      {betModal && (() => {
        const demo = DEMO_META[betModal.pactId.toLowerCase()];
        const onchainProb = probMap[betModal.pactId];
        const breach = onchainProb !== undefined && onchainProb !== 5000
          ? onchainProb / 100
          : (demo?.breachPct ?? 50);
        const isCommit = betModal.side === 0;
        const price = isCommit ? (100 - breach) : breach;
        const amt = parseFloat(betAmount || "0");
        const shares = price > 0 ? (amt / (price / 100)) : 0;
        return (
          <div className="modal-overlay" onClick={() => !betPending && setBetModal(null)}>
            <div className="modal bet-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">
                <CircleDollarSign size={18} />
                <h2>{isCommit ? t("backCommit") : t("backSkeptic")}</h2>
                <button className="icon-button close" onClick={() => !betPending && setBetModal(null)}><X size={16} /></button>
              </div>
              {demo && <p className="bet-market-title">{tb(demo.title)}</p>}
              <div className={`bet-side-banner ${isCommit ? "commit" : "skeptic"}`}>
                <span>{isCommit ? t("thinkKept") : t("thinkBreach")}</span>
                <strong>{price.toFixed(0)}¢ {t("perShare")}</strong>
              </div>
              <label>
                {t("betAmountLabel")}
                <input
                  autoFocus
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  placeholder="0.1"
                />
              </label>
              <div className="bet-quick">
                {["0.1", "0.5", "1", "5"].map((v) => (
                  <button key={v} className="bet-chip" onClick={() => setBetAmount(v)}>{v} ETH</button>
                ))}
              </div>
              <dl className="bet-summary">
                <div><dt>{t("estShares")}</dt><dd>{shares.toFixed(2)}</dd></div>
                <div><dt>{t("winReturn")}</dt><dd>{shares.toFixed(2)} ETH</dd></div>
                <div><dt>{t("currentPrice")}</dt><dd>{price.toFixed(0)}¢</dd></div>
              </dl>
              <button className="wide primary" onClick={confirmBet} disabled={betPending || amt <= 0}>
                <Wallet size={16} /> {betPending ? t("walletConfirming") : `${t("confirmBet")} ${betAmount} ETH`}
              </button>
              <div className="hint-box">
                {t("betHint")}
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}

export default App;
