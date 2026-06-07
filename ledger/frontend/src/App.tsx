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
import "./styles.css";

const OUTCOMES = ["Pending", "Kept", "Breached"];
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

function cardTitle(row: PactRow, identity?: Identity): string {
  const name = identity?.displayName ?? identity?.twitterHandle ?? short(row.subject);
  if (row.predType === 1) return `Will ${name} deploy the milestone contract on time?`;
  if (row.predType === 3) return `Will ${name} complete the 30-day habit streak?`;
  if (row.predType === 4) return `Will ${name} meet the public policy commitment target?`;
  return `Will ${name} fulfil this commitment?`;
}

function timeLeft(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Expired";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
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
  {
    id: "l1-habit",
    tier: "L1 Habit",
    title: "Will 0x30e3...f92 complete 24 morning runs in 30 days?",
    deadline: "30d",
    odds: "42%",
    bond: "0.001",
    author: "@repufi_demo",
    kyc: true,
    twitterVerified: true,
  },
  {
    id: "l2-delivery",
    tier: "L2 Delivery",
    title: "Will 0x30e3...f92 launch mainnet and publish contract address by Q3?",
    deadline: "45d",
    odds: "58%",
    bond: "0.002",
    author: "@repufi_demo",
    kyc: true,
    twitterVerified: true,
  },
  {
    id: "l3-policy",
    tier: "L3 Policy",
    title: "Will 0x30e3...f92 improve public service satisfaction from 65% to 80%?",
    deadline: "60d",
    odds: "31%",
    bond: "0.003",
    author: "@repufi_demo",
    kyc: true,
    twitterVerified: true,
  },
];

const SAMPLE_ODDS = [18, 28, 24, 37, 34, 44, 39, 52, 46, 38.75];

// Polymarket-style circular probability gauge (shows YES = kept probability)
function ProbGauge({ breachPct }: { breachPct: number }) {
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
        <span>kept</span>
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
  const [account, setAccount] = useState("");
  const [rows, setRows] = useState<PactRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Pact | null>(null);
  const [breachProb, setBreachProb] = useState<bigint>(0n);
  const [profileAddress, setProfileAddress] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [message, setMessage] = useState("Ready. Start local chain, deploy, then refresh markets.");
  const [target, setTarget] = useState(ZeroAddress);
  const [bond, setBond] = useState("1");
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

  // Per-market breach probability (bps) for card gauges
  const [probMap, setProbMap] = useState<Record<string, number>>({});

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const totalLiquidity = selected ? selected.commitPool + selected.skepticPool + selected.bond : 0n;
  const activeQuest = selected ? (selected.outcome === 0n ? "Trading" : OUTCOMES[Number(selected.outcome)]) : "Scout";

  // Separate list refresh (slow, full scan) from detail refresh (fast, single pact)
  async function refreshList() {
    const nextRows = await loadPactCreated();
    setRows(nextRows);
    if (!selectedId && nextRows[0]?.id) {
      setSelectedId(nextRows[0].id);
    }
    setMessage(nextRows.length
      ? `${nextRows.length} market${nextRows.length > 1 ? "s" : ""} loaded.`
      : "No markets yet. Create a pact to start.");

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
      setMessage("No subject address selected.");
      return;
    }
    const { credibility } = getReadContracts();
    const value = await credibility.profileOf(addr);
    setProfileAddress(addr);
    setProfile(value as Profile);
    setMessage(`Loaded profile ${short(addr)}.`);
  }

  // On mount: load list once, then poll list every 15s (not on every selection change)
  useEffect(() => {
    refreshList().catch((error) => setMessage(`RPC offline: ${error.shortMessage ?? error.message}`));
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
    setMessage(`Wallet linked: ${short(contracts.account)}.`);
  }

  async function reviewGoal() {
    if (!goalText.trim()) {
      setMessage("Enter a goal first.");
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
        setMessage(`Brain approved: ${data.predicate.paramsSummary}`);
      } else {
        setMessage(`Brain rejected — see suggestions below.`);
      }
    } catch {
      setMessage(`Brain API unavailable — fill milestone target manually.`);
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
    setMessage("Minting commitment quest...");
    await tx.wait();
    setMessage("Quest listed on the market board.");
    await refresh();
  }

  async function takePosition() {
    if (!selectedId) {
      setMessage("Select a market first.");
      return;
    }
    const { market } = await getWriteContracts();
    const tx = await market.takePosition(selectedId, side, { value: parseEther(stake) });
    setMessage(side === 0 ? "Backing Commit side..." : "Backing Skeptic side...");
    await tx.wait();
    setMessage("Position confirmed on-chain.");
    await refresh();
  }

  async function selfResolve() {
    if (!selectedId || !selectedRow) {
      setMessage("Select a market first.");
      return;
    }
    const { resolver } = await getWriteContracts();
    const tx = await resolver.selfResolve(selectedId, selectedRow.predType, selectedRow.paramsBlob);
    setMessage("Resolver checking milestone...");
    await tx.wait();
    setMessage("Market resolved.");
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
      setMessage("Select a market first.");
      return;
    }
    const { market } = await getWriteContracts();
    const tx = await market.claim(selectedId);
    setMessage("Claim transaction pending...");
    await tx.wait();
    setMessage("Reward claimed.");
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
  const previewQuest = hasMarkets ? activeQuest : "Demo";

  const guide = !connected
    ? { n: 1, label: "Connect Wallet", hint: "Link a wallet to begin.", icon: <Wallet size={18} />, action: connect }
    : !hasMarkets
    ? { n: 2, label: "Create the First Pact", hint: "No markets yet — launch a commitment quest.", icon: <Target size={18} />, action: openCreate }
    : !selected
    ? { n: 2, label: "Pick a Market", hint: "Choose a quest from the board to trade.", icon: <Activity size={18} />, action: () => focusPanel(boardRef, "board") }
    : isPending
    ? { n: 3, label: "Stake a Position", hint: "Back Commit (kept) or Skeptic (breach).", icon: <CircleDollarSign size={18} />, action: () => focusPanel(detailRef, "detail") }
    : { n: 4, label: "Resolve & Earn Credibility", hint: "Settle the pact and update the SBT.", icon: <Flag size={18} />, action: () => focusPanel(detailRef, "detail") };

  const steps = [
    { label: "Connect", done: connected },
    { label: "Create / Stake", done: hasMarkets },
    { label: "Trade Odds", done: traded },
    { label: "Resolve", done: isResolved }
  ];

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">RF</span>
          <div>
            <h1>RepuFi</h1>
            <p>Commitment markets and credibility primitives</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button onClick={openCreate}><Target size={16} /> New Pact</button>
          <button className={showProfile ? "toggle-on" : ""} onClick={() => setShowProfile((value) => !value)}><UserRound size={16} /> Credibility</button>
          <button className="icon-button" onClick={refresh} title="Refresh markets">
            <RefreshCcw size={18} />
          </button>
          <button onClick={connect}><Wallet size={16} /> {account ? short(account) : "Connect"}</button>
        </div>
      </header>

      <Reveal className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Beijing ETH demo console</span>
          <h2 className="hero-title">Price commitment risk with on-chain markets.</h2>
          <p className="hero-sub">Create a pact, let Commit and Skeptic capital price the breach probability, then resolve outcomes into a credibility profile.</p>
          <div className="hero-cta-row">
            <button className="cta primary" onClick={guide.action}>{guide.icon} {guide.label}</button>
            <button className="cta secondary" onClick={refresh}><RefreshCcw size={16} /> Refresh</button>
          </div>
        </div>
        <div className="hero-panel">
          <div className="hero-panel-head">
            <span>{hasMarkets ? "Current market" : "Sample market"}</span>
            <b>{previewQuest}</b>
          </div>
          <div className="risk-meter" aria-label="Breach probability">
            <span style={{ width: `${previewBreachProb}%` }} />
          </div>
          <dl className="hero-metrics">
            <div><dt>Markets</dt><dd>{previewMarketCount}</dd></div>
            <div><dt>Breach odds</dt><dd>{selected ? pct(breachProb) : "38.75%"}</dd></div>
            <div><dt>Liquidity</dt><dd>{previewLiquidity}</dd></div>
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
        <h2 className="section-title">Live Markets</h2>
        <span className="section-sub">{guide.hint}</span>
      </Reveal>

      <Reveal className={`grid ${showCreate ? "cols-3" : "cols-2"}`}>
        {showCreate && (
          <div className={`panel create-panel ${flash === "create" ? "flash" : ""}`} ref={createRef}>
            <div className="panel-title">
              <Scale size={18} />
              <h2>Create Pact</h2>
              <button className="icon-button close" onClick={() => setShowCreate(false)} title="Close"><X size={16} /></button>
            </div>

            {/* Brain goal intake */}
            <label>
              Commitment goal (natural language)
              <input
                id="milestone-input"
                placeholder="e.g. Q3 结束前完成主网上线并公布合约地址"
                value={goalText}
                onChange={(e) => { setGoalText(e.target.value); setBrainReview(null); }}
              />
            </label>
            <div className="split">
              <label>
                Scenario
                <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  <option value="l2-delivery">L2 Project delivery</option>
                  <option value="l1-habit">L1 Personal habit</option>
                  <option value="l3-policy">L3 Public accountability</option>
                </select>
              </label>
              <label>
                Bond ETH
                <input value={bond} onChange={(event) => setBond(event.target.value)} />
              </label>
            </div>
            <button className="wide" onClick={reviewGoal} disabled={brainPending}>
              <Brain size={16} /> {brainPending ? "Analyzing…" : "Review with Brain Agent"}
            </button>

            {/* Brain review result */}
            {brainReview && (
              <div className={`brain-result ${brainReview.accepted ? "accepted" : "rejected"}`}>
                {brainReview.accepted ? (
                  <>
                    <strong>✓ Goal approved</strong>
                    <small>{brainReview.paramsSummary}</small>
                  </>
                ) : (
                  <>
                    <strong>✗ Goal rejected</strong>
                    <ul>{brainReview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    {brainReview.rewrittenGoal && (
                      <div className="rewrite-suggestion">
                        <span>Brain suggests:</span>
                        <em>"{brainReview.rewrittenGoal}"</em>
                        <button
                          className="adopt-btn"
                          onClick={() => {
                            setGoalText(brainReview.rewrittenGoal!);
                            setBrainReview(null);
                          }}
                        >
                          Adopt suggestion
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <label>
              Milestone target address
              <input value={target} onChange={(event) => setTarget(event.target.value)} />
            </label>
            <label>
              Deadline min
              <input value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
            </label>
            <button
              className="wide primary"
              onClick={createPact}
              disabled={brainReview !== null && !brainReview.accepted}
            >
              <Target size={16} /> List Quest
            </button>
            <div className="hint-box">
              Subject stakes the bond. Commit backs delivery. Skeptic prices breach risk.
            </div>
          </div>
        )}

        <div className={`panel market-list ${flash === "board" ? "flash" : ""}`} ref={boardRef}>
          <div className="panel-title">
            <Activity size={18} />
            <h2>Markets</h2>
          </div>

          {/* Category filter tabs */}
          <div className="cat-tabs">
            {(["All", "L1", "L2", "L3"] as const).map((cat) => (
              <button
                key={cat}
                className={`cat-tab ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === "All" ? "All" : cat === "L1" ? "L1 Habit" : cat === "L2" ? "L2 Delivery" : "L3 Policy"}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="sample-list">
              <div className="sample-note">
                <Trophy size={18} />
                Demo markets — connect to Sepolia to see live data.
              </div>
              {SAMPLE_MARKETS
                .filter((m) => activeCategory === "All" || m.tier.startsWith(activeCategory))
                .map((market) => {
                  const breach = parseFloat(market.odds);
                  return (
                    <div key={market.id} className="pm-card sample-row" onClick={openCreate}>
                      <div className="pm-card-top">
                        <div className="pm-icon">{market.tier.slice(0, 2)}</div>
                        <div className="pm-title-wrap">
                          <p className="pm-title">{market.title}</p>
                          <span className="pm-cat">{market.tier}</span>
                        </div>
                        <ProbGauge breachPct={breach} />
                      </div>
                      <div className="pm-actions">
                        <button className="pm-btn commit" onClick={(e) => { e.stopPropagation(); openCreate(); }}>
                          Commit <b>{(100 - breach).toFixed(0)}¢</b>
                        </button>
                        <button className="pm-btn skeptic" onClick={(e) => { e.stopPropagation(); openCreate(); }}>
                          Skeptic <b>{breach.toFixed(0)}¢</b>
                        </button>
                      </div>
                      <div className="pm-footer">
                        <span className="pm-vol">{market.bond} ETH bond</span>
                        <div className="pm-ids">
                          {market.twitterVerified && <span className="id-badge twitter">𝕏 {market.author}</span>}
                          {market.kyc && <span className="id-badge kyc">KYC ✓</span>}
                          <span className="pm-deadline">{market.deadline}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              <button className="wide primary" onClick={openCreate}><Target size={16} /> Create a Real Pact</button>
            </div>
          ) : null}

          {rows
            .filter((row) => activeCategory === "All" || PRED_TIER[row.predType] === activeCategory)
            .map((row) => {
              const isActive = row.id === selectedId;
              const tier = PRED_LABELS[row.predType] ?? "Commitment";
              const identity = identityStore[row.subject.toLowerCase()];
              const breach = (probMap[row.id] ?? 5000) / 100; // bps → pct
              const kept = 100 - breach;
              return (
                <div
                  key={row.id}
                  className={`pm-card ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <div className="pm-card-top">
                    <div className="pm-icon">{tier.slice(0, 2)}</div>
                    <div className="pm-title-wrap">
                      <p className="pm-title">{cardTitle(row, identity)}</p>
                      <span className="pm-cat">{tier}</span>
                    </div>
                    <ProbGauge breachPct={breach} />
                  </div>
                  <div className="pm-actions">
                    <button
                      className="pm-btn commit"
                      onClick={(e) => { e.stopPropagation(); setSelectedId(row.id); setSide(0); focusPanel(detailRef, "detail"); }}
                    >
                      Commit <b>{kept.toFixed(0)}¢</b>
                    </button>
                    <button
                      className="pm-btn skeptic"
                      onClick={(e) => { e.stopPropagation(); setSelectedId(row.id); setSide(1); focusPanel(detailRef, "detail"); }}
                    >
                      Skeptic <b>{breach.toFixed(0)}¢</b>
                    </button>
                  </div>
                  <div className="pm-footer">
                    <span className="pm-vol">{eth(row.bond)} ETH bond</span>
                    <div className="pm-ids">
                      {identity?.twitterHandle
                        ? <span className="id-badge twitter">𝕏 {identity.twitterHandle}</span>
                        : <span className="id-badge unverified">Unverified</span>}
                      {identity?.kycPassed && <span className="id-badge kyc">KYC ✓</span>}
                      <span className="pm-deadline">{timeLeft(row.deadline)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className={`panel detail ${flash === "detail" ? "flash" : ""}`} ref={detailRef}>
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>Odds & Settlement</h2>
            {detailLoading && <span className="loading-dot" aria-label="Loading…" />}
          </div>
          {selected ? (
            <>
              <div className={`price-band ${outcomeClass(selected.outcome)}`}>
                <div>
                  <span className="label">Implied breach probability</span>
                  <strong>{pct(breachProb)}</strong>
                </div>
                <span className="outcome-pill">{OUTCOMES[Number(selected.outcome)]}</span>
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
                <button className={side === 0 ? "side active" : "side"} onClick={() => setSide(0)}>Commit</button>
                <button className={side === 1 ? "side active skeptic" : "side"} onClick={() => setSide(1)}>Skeptic</button>
                <label>
                  Stake ETH
                  <input value={stake} onChange={(event) => setStake(event.target.value)} />
                </label>
                <button className="primary" onClick={takePosition}><CircleDollarSign size={16} /> Stake</button>
              </div>

              <dl className="facts">
                <div><dt>Subject</dt><dd>{short(selected.subject)}</dd></div>
                <div><dt>Bond</dt><dd>{eth(selected.bond)} ETH</dd></div>
                <div><dt>Commit Pool</dt><dd>{eth(selected.commitPool)} ETH</dd></div>
                <div><dt>Skeptic Pool</dt><dd>{eth(selected.skepticPool)} ETH</dd></div>
              </dl>

              {/* Identity card */}
              {(() => {
                const identity = identityStore[selected.subject.toLowerCase()];
                return (
                  <div className="identity-card">
                    <div className="identity-header">
                      <UserRound size={15} />
                      <strong>Creator Identity</strong>
                      <button
                        className="id-link-btn"
                        onClick={() => setShowIdentityModal(true)}
                        title="Link / verify identity"
                      >
                        {identity ? "Edit" : "+ Link"}
                      </button>
                    </div>
                    {identity ? (
                      <div className="identity-body">
                        {identity.displayName && <span className="id-name">{identity.displayName}</span>}
                        {identity.twitterHandle
                          ? <span className="id-badge twitter">𝕏 {identity.twitterHandle} ✓</span>
                          : <span className="id-badge unverified">No 𝕏 linked</span>}
                        <span className={`id-badge ${identity.kycPassed ? "kyc" : "unverified"}`}>
                          KYC {identity.kycPassed ? "✓ Passed" : "✗ Not verified"}
                        </span>
                        <span className="id-addr">{short(selected.subject)}</span>
                      </div>
                    ) : (
                      <p className="id-empty">
                        No identity linked. Link 𝕏 or complete KYC to build trust.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="actions">
                <button onClick={selfResolve}><Flag size={16} /> Resolve</button>
                <button onClick={claim}><BadgeCheck size={16} /> Claim</button>
              </div>

              {/* Resolution pipeline: UMA OO → Multi-Agent → Human Review */}
              {showResolution && (
                <div className="resolution-panel">
                  <div className="resolution-title">
                    <ShieldCheck size={16} />
                    <strong>Resolution Pipeline (UMA + Multi-Agent + Human Review)</strong>
                  </div>
                  <ol className="resolution-steps">
                    <li>
                      <strong>UMA Optimistic Oracle</strong>
                      <span>Proposer posts outcome + bond (0.1 ETH). Liveness window opens.</span>
                    </li>
                    <li>
                      <strong>Multi-Agent Cross-Check</strong>
                      <span>3 independent Brain agents verify evidence. Majority overrides if they disagree with UMA.</span>
                    </li>
                    <li>
                      <strong>Human Review (DVM)</strong>
                      <span>Disputed outcomes go to token-holder vote. Interest isolation applied.</span>
                    </li>
                  </ol>
                  {reviewVoters.length > 0 && (
                    <div className="voters-section">
                      <strong>Review Voter Eligibility ({reviewVoters.filter(v => v.eligible).length}/{reviewVoters.length} eligible)</strong>
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
                    <X size={14} /> Close
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="sample-detail">
              <div className="price-band sample">
                <div>
                  <span className="label">Sample breach probability</span>
                  <strong>38.75%</strong>
                </div>
                <span className="outcome-pill">Demo</span>
                <div className="bar"><span style={{ width: "38.75%" }} /></div>
                <div className="sparkline" aria-label="Sample price history">
                  {SAMPLE_ODDS.map((value, index, arr) => (
                    <i key={index} style={{ left: `${(index / (arr.length - 1)) * 100}%`, bottom: `${value}%` }} />
                  ))}
                </div>
              </div>

              <dl className="facts">
                <div><dt>Subject</dt><dd>0x7A3F...B92C</dd></div>
                <div><dt>Bond</dt><dd>2.5 ETH</dd></div>
                <div><dt>Commit Pool</dt><dd>8.7 ETH</dd></div>
                <div><dt>Skeptic Pool</dt><dd>5.5 ETH</dd></div>
              </dl>

              <div className="trade-box disabled-preview" aria-disabled="true">
                <button className="side active">Commit</button>
                <button className="side">Skeptic</button>
                <label>
                  Stake ETH
                  <input value="1.0" readOnly />
                </label>
                <button className="primary" onClick={openCreate}><Target size={16} /> Create Live Market</button>
              </div>
            </div>
          )}
        </div>

        {showProfile && (
          <div className="panel profile">
            <div className="panel-title">
              <UserRound size={18} />
              <h2>Credibility Card</h2>
              <button className="icon-button close" onClick={() => setShowProfile(false)} title="Close"><X size={16} /></button>
            </div>
            <label>
              Subject address
              <input value={profileAddress} onChange={(event) => setProfileAddress(event.target.value)} />
            </label>
            <button className="wide" onClick={() => refreshProfile()}>Load Profile</button>
            {profile ? (
              <dl className="facts profile-facts">
                <div><dt>Score</dt><dd>{eth(profile.score)} ETH</dd></div>
                <div><dt>Kept</dt><dd>{profile.kept.toString()}</dd></div>
                <div><dt>Broken</dt><dd>{profile.broken.toString()}</dd></div>
                <div><dt>Staked Kept</dt><dd>{eth(profile.stakedKept)} ETH</dd></div>
              </dl>
            ) : (
              <div className="hint-box">Select a market or paste a subject address to inspect its SBT record.</div>
            )}
          </div>
        )}
      </Reveal>
      </div>

      {message ? <Reveal className="status">{message}</Reveal> : null}

      {/* Identity Link Modal */}
      {showIdentityModal && selected && (
        <div className="modal-overlay" onClick={() => setShowIdentityModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <UserRound size={18} />
              <h2>Link Identity</h2>
              <button className="icon-button close" onClick={() => setShowIdentityModal(false)}><X size={16} /></button>
            </div>
            <p className="modal-sub">
              Link your 𝕏 account or KYC to build trust with market participants.
              Identity is stored locally and shown to other users when they view this market.
            </p>
            <label>
              𝕏 (Twitter) handle
              <input
                placeholder="@yourhandle"
                value={pendingTwitter}
                onChange={(e) => setPendingTwitter(e.target.value)}
              />
            </label>
            <div className="modal-kyc-row">
              <span>KYC Verification</span>
              <span className="hint-text">Full KYC coming soon. For demo, click Simulate.</span>
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
                  setMessage("𝕏 identity linked.");
                }}
              >
                <UserRound size={15} /> Link 𝕏
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
                  setMessage("KYC simulated as passed.");
                }}
              >
                <BadgeCheck size={15} /> Simulate KYC ✓
              </button>
            </div>
            <div className="hint-box" style={{ marginTop: 12 }}>
              Participants with conflicts of interest are excluded from the human review vote.
              Your identity helps enforce interest isolation rules.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
