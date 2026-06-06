import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CircleDollarSign,
  Flag,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  TerminalSquare,
  Trophy,
  UserRound,
  Wallet
} from "lucide-react";
import { AbiCoder, ZeroAddress, formatEther, parseEther } from "ethers";
import {
  getReadContracts,
  getWriteContracts,
  loadPactCreated,
  loadPriceHistory,
  Pact,
  PactRow,
  PricePoint,
  rpcUrl
} from "./contracts";
import "./styles.css";

const OUTCOMES = ["Pending", "Kept", "Breached"];
const ONCHAIN_MILESTONE = 1;

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

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const totalLiquidity = selected ? selected.commitPool + selected.skepticPool + selected.bond : 0n;
  const activeQuest = selected ? (selected.outcome === 0n ? "Trading" : OUTCOMES[Number(selected.outcome)]) : "Scout";

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
    } else {
      setSelected(null);
      setBreachProb(0n);
      setPriceHistory([]);
    }
    setMessage(nextRows.length ? `Loaded ${nextRows.length} on-chain market${nextRows.length > 1 ? "s" : ""}.` : "No markets yet. Create a pact to start.");
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

  useEffect(() => {
    refresh().catch((error) => setMessage(`RPC offline: ${error.shortMessage ?? error.message}`));
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

  async function connect() {
    const contracts = await getWriteContracts();
    setAccount(contracts.account);
    setMessage(`Wallet linked: ${short(contracts.account)}.`);
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

  return (
    <main className="app">
      <header className="topbar pixel-frame">
        <div className="brand-lockup">
          <span className="brand-mark">RF</span>
          <div>
            <h1>RepuFi Arcade</h1>
            <p>On-chain commitment markets and credibility.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="rpc"><TerminalSquare size={15} /> {rpcUrl}</span>
          <button className="icon-button" onClick={refresh} title="Refresh markets">
            <RefreshCcw size={18} />
          </button>
          <button onClick={connect}><Wallet size={16} /> {account ? short(account) : "Connect"}</button>
        </div>
      </header>

      <section className="score-strip">
        <div className="score-tile">
          <span>Markets</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="score-tile">
          <span>Active Quest</span>
          <strong>{activeQuest}</strong>
        </div>
        <div className="score-tile">
          <span>Breach Odds</span>
          <strong>{selected ? pct(breachProb) : "--"}</strong>
        </div>
        <div className="score-tile">
          <span>Liquidity</span>
          <strong>{selected ? `${eth(totalLiquidity)} ETH` : "--"}</strong>
        </div>
      </section>

      <section className="quest-hero pixel-frame">
        <div className="hero-copy">
          <div className="mini-label"><Sparkles size={14} /> Demo route</div>
          <h2>
            <span>Launch pact.</span>
            <span>Price risk.</span>
            <span>Settle reputation.</span>
          </h2>
          <p>HackQuest-style missions with Polymarket-style odds, pools, and outcomes.</p>
        </div>
        <div className="quest-steps">
          <span className="step done">1 Compile goal</span>
          <span className="step done">2 Stake bond</span>
          <span className={`step ${rows.length ? "done" : ""}`}>3 Trade odds</span>
          <span className={`step ${selected?.outcome ? "done" : ""}`}>4 Resolve</span>
        </div>
      </section>

      <section className="grid">
        <div className="panel create-panel pixel-frame">
          <div className="panel-title">
            <Scale size={18} />
            <h2>Create Quest Market</h2>
          </div>
          <label>
            Milestone target
            <input value={target} onChange={(event) => setTarget(event.target.value)} />
          </label>
          <div className="split">
            <label>
              Bond ETH
              <input value={bond} onChange={(event) => setBond(event.target.value)} />
            </label>
            <label>
              Deadline min
              <input value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
            </label>
          </div>
          <button className="wide primary" onClick={createPact}><Target size={16} /> List Quest</button>
          <div className="hint-box">
            Subject stakes the bond. Commit backs delivery. Skeptic prices breach risk.
          </div>
        </div>

        <div className="panel market-list pixel-frame">
          <div className="panel-title">
            <Activity size={18} />
            <h2>Market Board</h2>
          </div>
          {rows.length === 0 ? (
            <div className="empty-state">
              <Trophy size={24} />
              <strong>No quests listed</strong>
              <span>Start Hardhat, deploy contracts, or create the first pact.</span>
            </div>
          ) : null}
          {rows.map((row, index) => (
            <button
              key={row.id}
              className={`market-row ${row.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(row.id)}
            >
              <span className="market-rank">#{String(index + 1).padStart(2, "0")}</span>
              <span className="market-main">
                <strong>Will {short(row.subject)} deploy milestone?</strong>
                <small>{short(milestoneTarget(row.paramsBlob))} target · {eth(row.bond)} ETH bond</small>
              </span>
            </button>
          ))}
        </div>

        <div className="panel detail pixel-frame">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>Odds Terminal</h2>
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
                <div><dt>Target</dt><dd>{selectedRow ? short(milestoneTarget(selectedRow.paramsBlob)) : "-"}</dd></div>
                <div><dt>Bond</dt><dd>{eth(selected.bond)} ETH</dd></div>
                <div><dt>Commit Pool</dt><dd>{eth(selected.commitPool)} ETH</dd></div>
                <div><dt>Skeptic Pool</dt><dd>{eth(selected.skepticPool)} ETH</dd></div>
                <div><dt>Winner Rewards</dt><dd>{eth(selected.rewardPool)} ETH</dd></div>
                <div><dt>Insurance</dt><dd>{eth(selected.insurancePool)} ETH</dd></div>
                <div><dt>Community</dt><dd>{eth(selected.communityPool)} ETH</dd></div>
              </dl>

              <div className="actions">
                <button onClick={selfResolve}><Flag size={16} /> Resolve</button>
                <button onClick={claim}><BadgeCheck size={16} /> Claim</button>
              </div>
            </>
          ) : (
            <div className="empty-state tall">
              <ShieldCheck size={26} />
              <strong>Select a market</strong>
              <span>Odds, pools, settlement buckets, and claim controls appear here.</span>
            </div>
          )}
        </div>

        <div className="panel profile pixel-frame">
          <div className="panel-title">
            <UserRound size={18} />
            <h2>Credibility Card</h2>
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
      </section>

      {message ? <div className="status pixel-frame">{message}</div> : null}
    </main>
  );
}

export default App;
