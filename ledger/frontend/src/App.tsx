import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CircleDollarSign,
  Flag,
  RefreshCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Vote,
  Wallet
} from "lucide-react";
import { AbiCoder, ZeroAddress, formatEther, getBytes, id, parseEther } from "ethers";
import {
  analyzeGoalForDemo,
  buildDemoResolution,
  compileDemoPredicate,
  demoScenarioTemplates,
  eligibleReviewVoters,
  scenarioById,
  type DemoPredicate,
  type DemoResolution,
  type DemoScenarioTemplate,
  type GoalAnalysis,
  type ReviewVoter,
  type ScenarioCategory
} from "../../shared/demoWorkflow";
import { Outcome, PredType, Side, type Hex } from "../../shared/schemas";
import {
  demoWalletRoles,
  getLocalVerifierSigner,
  getReadContracts,
  getWriteContracts,
  loadPactCreated,
  loadPriceHistory,
  Pact,
  PactRow,
  PricePoint,
  rpcUrl,
  type DemoWalletRoleId
} from "./contracts";
import "./styles.css";

const OUTCOMES = ["Pending", "Kept", "Breached"];
const SIDES = ["Commit", "Skeptic"];
const ALL_CATEGORIES = "All";
const brainApiUrl = import.meta.env.VITE_BRAIN_API_URL ?? "http://127.0.0.1:8790";
const DEFAULT_REVIEW_SUBJECT = "0x4000000000000000000000000000000000000004" as Hex;
const DEFAULT_PARTICIPANTS = [
  { address: "0x1000000000000000000000000000000000000001", side: Side.Commit },
  { address: "0x2000000000000000000000000000000000000002", side: Side.Skeptic }
] as const;
const DEFAULT_RELATED = ["0x3000000000000000000000000000000000000003"] as const;
const DEFAULT_TOKEN_HOLDERS = [
  "0x1000000000000000000000000000000000000001",
  "0x2000000000000000000000000000000000000002",
  "0x3000000000000000000000000000000000000003",
  DEFAULT_REVIEW_SUBJECT,
  "0x5000000000000000000000000000000000000005"
] as const;

type Profile = {
  score: bigint;
  kept: bigint;
  broken: bigint;
  stakedKept: bigint;
  updated: bigint;
};

type CategoryFilter = ScenarioCategory | typeof ALL_CATEGORIES;
type DemoPactMetadata = {
  goal: string;
  scenarioId: DemoScenarioTemplate["id"];
  category: ScenarioCategory;
  createdAt: number;
};
type IntakeDecision = {
  accepted: boolean;
  analysis: GoalAnalysis;
  predicate?: DemoPredicate;
};
type DemoRunbookStep = {
  id: DemoScenarioTemplate["id"];
  marker: string;
  betSide: Side;
  resolution: "Oracle agrees" | "Escalate review";
  voter: string;
};

const METADATA_KEY = "repufi.demoPactMetadata.v1";
const demoRunbook: DemoRunbookStep[] = [
  {
    id: "l1-habit",
    marker: "l1-intake",
    betSide: Side.Commit,
    resolution: "Oracle agrees",
    voter: "Local verifier settles Kept"
  },
  {
    id: "l2-delivery",
    marker: "l2-market",
    betSide: Side.Skeptic,
    resolution: "Oracle agrees",
    voter: "Local verifier settles Breached"
  },
  {
    id: "l3-policy",
    marker: "l3-review",
    betSide: Side.Skeptic,
    resolution: "Escalate review",
    voter: "Local owner + Local REPU reviewer vote Breached"
  }
];

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function pct(bps: bigint | number) {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function eth(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function scenarioForRow(row?: PactRow): DemoScenarioTemplate {
  if (!row) return demoScenarioTemplates[0];
  if (row.predType === PredType.HABIT) return scenarioById("l1-habit");
  if (row.predType === PredType.POLICY) return scenarioById("l3-policy");
  return scenarioById("l2-delivery");
}

function decodeTarget(paramsBlob: string, predType: number) {
  try {
    if (predType === PredType.ONCHAIN_MILESTONE) {
      return AbiCoder.defaultAbiCoder().decode(["address"], paramsBlob)[0] as string;
    }
    if (predType === PredType.HABIT) {
      const [requiredDays, cadence] = AbiCoder.defaultAbiCoder().decode(["uint16", "string"], paramsBlob);
      return `${requiredDays.toString()} ${cadence}`;
    }
    const [metric] = AbiCoder.defaultAbiCoder().decode(["string", "string"], paramsBlob);
    return metric as string;
  } catch {
    return ZeroAddress;
  }
}

function outcomeLabel(outcome: Outcome) {
  return outcome === Outcome.Kept ? "Kept" : outcome === Outcome.Breached ? "Breached" : "Pending";
}

function loadDemoMetadata(): Record<string, DemoPactMetadata> {
  try {
    const raw = window.localStorage.getItem(METADATA_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DemoPactMetadata>) : {};
  } catch {
    return {};
  }
}

function saveDemoMetadata(next: Record<string, DemoPactMetadata>) {
  window.localStorage.setItem(METADATA_KEY, JSON.stringify(next));
}

function pactCreatedId(market: any, logs: readonly unknown[]) {
  for (const log of logs) {
    try {
      const parsed = market.interface.parseLog(log);
      if (parsed?.name === "PactCreated") {
        return parsed.args.id as string;
      }
    } catch {
      continue;
    }
  }
  return "";
}

async function requestGoalIntake(input: {
  goal: string;
  stakeEth: string;
  scenarioId: string;
}): Promise<IntakeDecision> {
  const response = await fetch(`${brainApiUrl}/api/intake/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? "Brain intake request failed.");
  }
  return body as IntakeDecision;
}

function App() {
  const [account, setAccount] = useState("");
  const [walletRole, setWalletRole] = useState<DemoWalletRoleId>("browser");
  const [rows, setRows] = useState<PactRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Pact | null>(null);
  const [breachProb, setBreachProb] = useState<bigint>(0n);
  const [profileAddress, setProfileAddress] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviewTokenBalance, setReviewTokenBalance] = useState<bigint>(0n);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [message, setMessage] = useState("");
  const [scenarioId, setScenarioId] = useState(demoScenarioTemplates[0].id);
  const [goal, setGoal] = useState(demoScenarioTemplates[0].goal);
  const [bond, setBond] = useState(demoScenarioTemplates[0].defaultStakeEth);
  const [stake, setStake] = useState("0.25");
  const [side, setSide] = useState<Side>(Side.Commit);
  const [deadlineMinutes, setDeadlineMinutes] = useState(demoScenarioTemplates[0].defaultDeadlineMinutes);
  const [category, setCategory] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [analysis, setAnalysis] = useState<GoalAnalysis>(() =>
    analyzeGoalForDemo({ goal: demoScenarioTemplates[0].goal, stakeEth: demoScenarioTemplates[0].defaultStakeEth, scenarioId })
  );
  const [intakePredicate, setIntakePredicate] = useState<DemoPredicate | undefined>(() => compileDemoPredicate(demoScenarioTemplates[0]));
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [resolutionMode, setResolutionMode] = useState<"agree" | "disagree">("agree");
  const [metadataById, setMetadataById] = useState<Record<string, DemoPactMetadata>>(() => loadDemoMetadata());

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const selectedMetadata = selectedId ? metadataById[selectedId] : undefined;
  const activeScenario = useMemo(() => scenarioById(scenarioId), [scenarioId]);
  const selectedScenario = useMemo(
    () => (selectedMetadata ? scenarioById(selectedMetadata.scenarioId) : scenarioForRow(selectedRow)),
    [selectedMetadata, selectedRow]
  );
  const predicate = useMemo(() => compileDemoPredicate(activeScenario), [activeScenario]);
  const marketplaceRows = useMemo(() => {
    return rows.filter((row) => {
      const rowCategory = metadataById[row.id]?.category ?? scenarioForRow(row).category;
      return category === ALL_CATEGORIES || rowCategory === category;
    });
  }, [category, metadataById, rows]);
  const reviewVoters = useMemo<ReviewVoter[]>(
    () =>
      eligibleReviewVoters({
        subject: DEFAULT_REVIEW_SUBJECT,
        participants: DEFAULT_PARTICIPANTS,
        relatedParties: DEFAULT_RELATED,
        tokenHolders: DEFAULT_TOKEN_HOLDERS
      }),
    []
  );
  const resolution = useMemo<DemoResolution>(() => {
    const oracleOutcome = resolutionMode === "agree" ? Outcome.Kept : Outcome.Kept;
    const agentOutcomes: Array<Outcome.Kept | Outcome.Breached> =
      resolutionMode === "agree"
        ? [Outcome.Kept, Outcome.Kept, Outcome.Kept]
        : [Outcome.Breached, Outcome.Breached, Outcome.Kept];
    return buildDemoResolution({
      scenario: selectedScenario,
      oracleOutcome,
      agentOutcomes,
      participants: DEFAULT_PARTICIPANTS,
      relatedParties: DEFAULT_RELATED,
      reviewVoters
    });
  }, [resolutionMode, reviewVoters, selectedScenario]);

  async function refresh() {
    const nextRows = await loadPactCreated();
    setRows(nextRows);
    const nextSelectedId = selectedId || nextRows[0]?.id || "";
    if (!selectedId && nextSelectedId) {
      setSelectedId(nextSelectedId);
    }
    if (nextSelectedId) {
      const { market } = getReadContracts();
      const [pact, prob, history] = await Promise.all([
        market.getPact(nextSelectedId),
        market.impliedBreachProb(nextSelectedId),
        loadPriceHistory(nextSelectedId)
      ]);
      setSelected(pact as Pact);
      setBreachProb(prob as bigint);
      setPriceHistory(history);
    }
  }

  async function refreshProfile(addr = profileAddress || selected?.subject || account) {
    if (!addr) return;
    const { credibility } = getReadContracts();
    const value = await credibility.profileOf(addr);
    setProfileAddress(addr);
    setProfile(value as Profile);
  }

  async function refreshReviewToken(addr = account) {
    if (!addr) return;
    const { reviewToken } = getReadContracts();
    setReviewTokenBalance(await reviewToken.balanceOf(addr));
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    if (selected?.subject) {
      refreshProfile(selected.subject).catch(() => undefined);
    }
  }, [selected?.subject]);

  function updateScenario(nextScenarioId: string) {
    const next = scenarioById(nextScenarioId);
    setScenarioId(next.id);
    setGoal(next.goal);
    setBond(next.defaultStakeEth);
    setDeadlineMinutes(next.defaultDeadlineMinutes);
    setAnalysis(analyzeGoalForDemo({ goal: next.goal, stakeEth: next.defaultStakeEth, scenarioId: next.id }));
    setIntakePredicate(compileDemoPredicate(next));
  }

  async function runBrainIntake() {
    setIntakeLoading(true);
    try {
      const decision = await requestGoalIntake({ goal, stakeEth: bond, scenarioId });
      setAnalysis(decision.analysis);
      setIntakePredicate(decision.predicate);
      setMessage(decision.accepted ? "Brain Agent approved this goal" : "Brain Agent rejected this goal");
      return decision;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Brain intake request failed");
      throw error;
    } finally {
      setIntakeLoading(false);
    }
  }

  async function analyzeGoal() {
    await runBrainIntake();
  }

  async function connect() {
    const contracts = await getWriteContracts(walletRole);
    setAccount(contracts.account);
    setProfileAddress(contracts.account);
    setReviewTokenBalance(await contracts.reviewToken.balanceOf(contracts.account));
    setMessage(`Connected ${contracts.label}: ${short(contracts.account)}`);
  }

  async function createPact() {
    const decision = await runBrainIntake();
    const currentAnalysis = decision.analysis;
    setAnalysis(currentAnalysis);
    if (!decision.accepted || !decision.predicate) {
      setMessage("Agent rejected this goal. Tighten metric, deadline, and evidence first.");
      return;
    }

    const { market } = await getWriteContracts(walletRole);
    const currentPredicate = decision.predicate;
    const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60;
    const tx = await market.createPact(currentPredicate.predType, currentPredicate.paramsBlob, BigInt(deadline), {
      value: parseEther(bond)
    });
    setMessage("Publishing pact to the plaza...");
    const receipt = await tx.wait();
    const newPactId = pactCreatedId(market, receipt?.logs ?? []);
    if (newPactId) {
      const nextMetadata = {
        ...metadataById,
        [newPactId]: {
          goal: currentAnalysis.normalizedGoal,
          scenarioId: activeScenario.id,
          category: activeScenario.category,
          createdAt: Date.now()
        }
      };
      setMetadataById(nextMetadata);
      saveDemoMetadata(nextMetadata);
      setSelectedId(newPactId);
    }
    setMessage("Pact published");
    await refresh();
  }

  async function takePosition() {
    if (!selectedId) return;
    const { market } = await getWriteContracts(walletRole);
    const tx = await market.takePosition(selectedId, side, { value: parseEther(stake) });
    setMessage("Position pending...");
    await tx.wait();
    setMessage(`${SIDES[side]} position taken`);
    await refresh();
  }

  async function selfResolve() {
    if (!selectedId || !selectedRow) return;
    const { resolver } = await getWriteContracts(walletRole);
    const tx = await resolver.selfResolve(selectedId, selectedRow.predType, selectedRow.paramsBlob);
    setMessage("Self-resolve pending...");
    await tx.wait();
    setMessage("Pact resolved");
    await refresh();
    await refreshProfile();
  }

  async function submitDemoVerdict() {
    if (!selectedId) return;
    const { resolver } = await getWriteContracts(walletRole);
    const verifierSigner = await getLocalVerifierSigner();
    const evidenceHash = id(`${selectedId}:${selectedScenario.id}:${resolutionMode}:${outcomeLabel(resolution.finalOutcome)}`);
    const digest = await resolver.verdictDigest(selectedId, resolution.oracleOutcome, evidenceHash);
    const sig = await verifierSigner.signMessage(getBytes(digest));
    const tx =
      resolution.needsHumanReview
        ? await resolver.submitDisputedVerdict(
            selectedId,
            resolution.oracleOutcome,
            resolution.agentConsensus,
            evidenceHash,
            sig
          )
        : await resolver.submitVerdict(selectedId, resolution.finalOutcome, evidenceHash, sig);
    setMessage(resolution.needsHumanReview ? "Opening token-holder review..." : "Verifier verdict pending...");
    await tx.wait();
    setMessage(resolution.needsHumanReview ? "Review opened on-chain" : "Verifier verdict settled on-chain");
    await refresh();
    await refreshProfile();
  }

  async function voteReview(outcome: Outcome.Kept | Outcome.Breached) {
    if (!selectedId) return;
    const { resolver } = await getWriteContracts(walletRole);
    const tx = await resolver.voteReview(selectedId, outcome);
    setMessage(`Review vote pending: ${outcomeLabel(outcome)}`);
    await tx.wait();
    setMessage(`Review vote cast: ${outcomeLabel(outcome)}`);
    await refresh();
    await refreshProfile();
    await refreshReviewToken();
  }

  async function claim() {
    if (!selectedId) return;
    const { market } = await getWriteContracts(walletRole);
    const tx = await market.claim(selectedId);
    setMessage("Claim pending...");
    await tx.wait();
    setMessage("Claim complete");
    await refresh();
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>RepuFi Demo Console</h1>
          <p>Goal staking, marketplace betting, optimistic resolution, and credibility settlement.</p>
        </div>
        <div className="topbar-actions">
          <span className="rpc">RPC {rpcUrl}</span>
          <select className="wallet-select" value={walletRole} onChange={(event) => setWalletRole(event.target.value as DemoWalletRoleId)}>
            {demoWalletRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={refresh} title="Refresh">
            <RefreshCcw size={18} />
          </button>
          <button onClick={connect}>
            <Wallet size={16} />
            {account ? short(account) : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="workflow">
        <div className="panel create-panel">
          <div className="panel-title">
            <Scale size={18} />
            <h2>Goal intake</h2>
          </div>
          <label>
            Demo case
            <select value={scenarioId} onChange={(event) => updateScenario(event.target.value)}>
              {demoScenarioTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.tier} · {template.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            User goal
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} />
          </label>
          <div className="split">
            <label>
              Stake ETH
              <input value={bond} onChange={(event) => setBond(event.target.value)} />
            </label>
            <label>
              Deadline min
              <input value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
            </label>
          </div>
          <div className={`agent-result ${analysis.accepted ? "accepted" : "rejected"}`}>
            <div>
              {analysis.accepted ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
              <strong>{analysis.accepted ? "Brain Agent approved" : "Brain Agent rejected"}</strong>
            </div>
            <p>{analysis.reasons.join(" / ")}</p>
            <dl>
              <div><dt>Backend</dt><dd>{brainApiUrl}</dd></div>
              <div><dt>Quantifier</dt><dd>{analysis.quantifier}</dd></div>
              <div><dt>Deadline</dt><dd>{analysis.deadline}</dd></div>
              <div><dt>Evidence</dt><dd>{analysis.evidenceSource}</dd></div>
            </dl>
          </div>
          <div className="actions">
            <button onClick={analyzeGoal} disabled={intakeLoading}>
              <SlidersHorizontal size={16} />
              {intakeLoading ? "Analyzing..." : "Analyze"}
            </button>
            <button onClick={createPact} disabled={intakeLoading}>
              <Flag size={16} />
              Publish
            </button>
          </div>
          <div className="predicate">
            <span>{activeScenario.category}</span>
            <code>{intakePredicate?.paramsSummary ?? predicate.paramsSummary}</code>
          </div>
        </div>

        <div className="panel market-list">
          <div className="panel-title">
            <Activity size={18} />
            <h2>Plaza</h2>
          </div>
          <div className="filter-bar">
            {[ALL_CATEGORIES, ...demoScenarioTemplates.map((template) => template.category)].map((item) => (
              <button
                key={item}
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item as CategoryFilter)}
              >
                {item}
              </button>
            ))}
          </div>
          {marketplaceRows.length === 0 ? <p className="muted">No pacts in this category on the local chain.</p> : null}
          {marketplaceRows.map((row) => {
            const rowScenario = scenarioForRow(row);
            const metadata = metadataById[row.id];
            return (
              <button
                key={row.id}
                className={`market-row ${row.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(row.id)}
              >
                <span>
                  <strong>{metadata?.goal ?? rowScenario.goal}</strong>
                  <small>{metadata?.category ?? rowScenario.category}</small>
                </span>
                <small>{eth(row.bond)} ETH</small>
              </button>
            );
          })}
        </div>

        <div className="panel detail">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>Market detail</h2>
          </div>
          {selected ? (
            <>
              <div className="price-band">
                <div>
                  <span className="label">Implied breach probability</span>
                  <strong>{pct(breachProb)}</strong>
                </div>
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
              <dl className="facts">
                <div><dt>Goal</dt><dd>{selectedMetadata?.goal ?? selectedScenario.goal}</dd></div>
                <div><dt>Category</dt><dd>{selectedScenario.category}</dd></div>
                <div><dt>Subject</dt><dd>{short(selected.subject)}</dd></div>
                <div><dt>Predicate</dt><dd>{selectedRow ? decodeTarget(selectedRow.paramsBlob, selectedRow.predType) : "-"}</dd></div>
                <div><dt>Outcome</dt><dd>{OUTCOMES[Number(selected.outcome)]}</dd></div>
                <div><dt>Bond</dt><dd>{eth(selected.bond)} ETH</dd></div>
                <div><dt>Commit</dt><dd>{eth(selected.commitPool)} ETH</dd></div>
                <div><dt>Skeptic</dt><dd>{eth(selected.skepticPool)} ETH</dd></div>
                <div><dt>Winner rewards</dt><dd>{eth(selected.rewardPool)} ETH</dd></div>
                <div><dt>Insurance</dt><dd>{eth(selected.insurancePool)} ETH</dd></div>
                <div><dt>Community</dt><dd>{eth(selected.communityPool)} ETH</dd></div>
                <div><dt>Close prob</dt><dd>{pct(selected.closeProbBps)}</dd></div>
              </dl>
              <div className="split">
                <label>
                  Amount ETH
                  <input value={stake} onChange={(event) => setStake(event.target.value)} />
                </label>
                <label>
                  Side
                  <select value={side} onChange={(event) => setSide(Number(event.target.value) as Side)}>
                    <option value={Side.Commit}>Commit</option>
                    <option value={Side.Skeptic}>Skeptic</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <button onClick={takePosition}><CircleDollarSign size={16} /> Stake</button>
                <button onClick={selfResolve}><Flag size={16} /> Self resolve</button>
                <button onClick={claim}><BadgeCheck size={16} /> Claim</button>
              </div>
            </>
          ) : (
            <p className="muted">Select or publish a pact.</p>
          )}
        </div>

        <div className="panel resolution">
          <div className="panel-title">
            <Vote size={18} />
            <h2>Resolution demo</h2>
          </div>
          <div className="segmented">
            <button className={resolutionMode === "agree" ? "active" : ""} onClick={() => setResolutionMode("agree")}>
              Oracle agrees
            </button>
            <button className={resolutionMode === "disagree" ? "active" : ""} onClick={() => setResolutionMode("disagree")}>
              Escalate review
            </button>
          </div>
          <dl className="facts compact">
            <div><dt>Oracle</dt><dd>{outcomeLabel(resolution.oracleOutcome)}</dd></div>
            <div><dt>Agent consensus</dt><dd>{outcomeLabel(resolution.agentConsensus)}</dd></div>
            <div><dt>Final</dt><dd>{outcomeLabel(resolution.finalOutcome)}</dd></div>
            <div><dt>Winner side</dt><dd>{SIDES[resolution.distribution.winnerSide]}</dd></div>
            <div><dt>REPU balance</dt><dd>{account ? eth(reviewTokenBalance) : "Connect"}</dd></div>
          </dl>
          <ol className="timeline">
            {resolution.timeline.map((step) => (
              <li key={step.label}>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
          <div className="review-list">
            {resolution.reviewVoters.map((voter) => (
              <div key={voter.address} className={voter.eligible ? "eligible" : "blocked"}>
                <span>{short(voter.address)}</span>
                <small>{voter.reason}</small>
              </div>
            ))}
          </div>
          <button className="wide" onClick={submitDemoVerdict} disabled={!selected || Boolean(selected.settled)}>
            <ShieldCheck size={16} />
            {resolution.needsHumanReview ? "Open on-chain review" : "Submit verifier verdict"}
          </button>
          {resolution.needsHumanReview ? (
            <div className="actions">
              <button onClick={() => voteReview(Outcome.Breached)} disabled={!selected || Boolean(selected.settled)}>
                <Vote size={16} />
                Vote Breached
              </button>
              <button onClick={() => voteReview(Outcome.Kept)} disabled={!selected || Boolean(selected.settled)}>
                <Vote size={16} />
                Vote Kept
              </button>
            </div>
          ) : null}
          <p className="muted">{resolution.distribution.winnerReceives} {resolution.distribution.protocolBuckets}</p>
        </div>

        <div className="panel profile">
          <div className="panel-title">
            <UserRound size={18} />
            <h2>Credibility</h2>
          </div>
          <label>
            Subject address
            <input value={profileAddress} onChange={(event) => setProfileAddress(event.target.value)} />
          </label>
          <button className="wide" onClick={() => refreshProfile()}>Load profile</button>
          {profile ? (
            <dl className="facts">
              <div><dt>Score</dt><dd>{eth(profile.score)} ETH</dd></div>
              <div><dt>Kept</dt><dd>{profile.kept.toString()}</dd></div>
              <div><dt>Broken</dt><dd>{profile.broken.toString()}</dd></div>
              <div><dt>Staked kept</dt><dd>{eth(profile.stakedKept)} ETH</dd></div>
            </dl>
          ) : null}
        </div>

        <div className="panel runbook">
          <div className="panel-title">
            <BadgeCheck size={18} />
            <h2>Demo runbook</h2>
          </div>
          <div className="runbook-grid">
            {demoRunbook.map((step) => {
              const scenario = scenarioById(step.id);
              return (
                <article key={step.id} data-demo-marker={step.marker}>
                  <header>
                    <span>{scenario.tier}</span>
                    <strong>{scenario.title}</strong>
                  </header>
                  <dl>
                    <div><dt>Goal intake</dt><dd>Local subject publishes {scenario.defaultStakeEth} ETH after Brain approval</dd></div>
                    <div><dt>Plaza filter</dt><dd>{scenario.category}</dd></div>
                    <div><dt>Market action</dt><dd>{SIDES[step.betSide]} with Local {SIDES[step.betSide]} bettor</dd></div>
                    <div><dt>Resolution</dt><dd>{step.resolution}</dd></div>
                    <div><dt>Review</dt><dd>{step.voter}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {message ? <div className="status">{message}</div> : null}
    </main>
  );
}

export default App;
