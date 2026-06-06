import React, { useEffect, useMemo, useState } from "react";
import { Activity, BadgeCheck, CircleDollarSign, Flag, RefreshCcw, Scale, ShieldCheck, UserRound } from "lucide-react";
import { AbiCoder, ZeroAddress, formatEther, parseEther } from "ethers";
import { getReadContracts, getWriteContracts, loadPactCreated, loadPriceHistory, Pact, PactRow, PricePoint, rpcUrl } from "./contracts";
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

function App() {
  const [account, setAccount] = useState("");
  const [rows, setRows] = useState<PactRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Pact | null>(null);
  const [breachProb, setBreachProb] = useState<bigint>(0n);
  const [profileAddress, setProfileAddress] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState(ZeroAddress);
  const [bond, setBond] = useState("1");
  const [stake, setStake] = useState("1");
  const [side, setSide] = useState<0 | 1>(0);
  const [deadlineMinutes, setDeadlineMinutes] = useState("30");

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);

  async function refresh() {
    const nextRows = await loadPactCreated();
    setRows(nextRows);
    if (!selectedId && nextRows[0]) {
      setSelectedId(nextRows[0].id);
    }
    if (selectedId) {
      const { market } = getReadContracts();
      const [pact, prob, history] = await Promise.all([
        market.getPact(selectedId),
        market.impliedBreachProb(selectedId),
        loadPriceHistory(selectedId)
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

  async function connect() {
    const contracts = await getWriteContracts();
    setAccount(contracts.account);
    setMessage(`Connected ${short(contracts.account)}`);
  }

  async function createPact() {
    const { market } = await getWriteContracts();
    const paramsBlob = AbiCoder.defaultAbiCoder().encode(["address"], [target]);
    const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60;
    const tx = await market.createPact(ONCHAIN_MILESTONE, paramsBlob, BigInt(deadline), { value: parseEther(bond) });
    setMessage("Creating pact...");
    await tx.wait();
    setMessage("Pact created");
    await refresh();
  }

  async function takePosition() {
    if (!selectedId) return;
    const { market } = await getWriteContracts();
    const tx = await market.takePosition(selectedId, side, { value: parseEther(stake) });
    setMessage("Position pending...");
    await tx.wait();
    setMessage("Position taken");
    await refresh();
  }

  async function selfResolve() {
    if (!selectedId || !selectedRow) return;
    const { resolver } = await getWriteContracts();
    const tx = await resolver.selfResolve(selectedId, selectedRow.predType, selectedRow.paramsBlob);
    setMessage("Self-resolve pending...");
    await tx.wait();
    setMessage("Pact resolved");
    await refresh();
    await refreshProfile();
  }

  async function claim() {
    if (!selectedId) return;
    const { market } = await getWriteContracts();
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
          <h1>PACT Ledger</h1>
          <p>Commitment markets, settlement, and credibility SBT on one local ledger.</p>
        </div>
        <div className="topbar-actions">
          <span className="rpc">RPC {rpcUrl}</span>
          <button className="icon-button" onClick={refresh} title="Refresh">
            <RefreshCcw size={18} />
          </button>
          <button onClick={connect}>{account ? short(account) : "Connect"}</button>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <div className="panel-title">
            <Scale size={18} />
            <h2>Create Pact</h2>
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
          <button className="wide" onClick={createPact}>Create</button>
        </div>

        <div className="panel market-list">
          <div className="panel-title">
            <Activity size={18} />
            <h2>Markets</h2>
          </div>
          {rows.length === 0 ? <p className="muted">No pacts found on this local chain.</p> : null}
          {rows.map((row) => (
            <button
              key={row.id}
              className={`market-row ${row.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(row.id)}
            >
              <span>{short(row.id)}</span>
              <small>{short(milestoneTarget(row.paramsBlob))} · {eth(row.bond)} ETH</small>
            </button>
          ))}
        </div>

        <div className="panel detail">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>Pact Detail</h2>
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
                <div><dt>Subject</dt><dd>{short(selected.subject)}</dd></div>
                <div><dt>Target</dt><dd>{selectedRow ? short(milestoneTarget(selectedRow.paramsBlob)) : "-"}</dd></div>
                <div><dt>Outcome</dt><dd>{OUTCOMES[Number(selected.outcome)]}</dd></div>
                <div><dt>Bond</dt><dd>{eth(selected.bond)} ETH</dd></div>
                <div><dt>Commit</dt><dd>{eth(selected.commitPool)} ETH</dd></div>
                <div><dt>Skeptic</dt><dd>{eth(selected.skepticPool)} ETH</dd></div>
                <div><dt>Close prob</dt><dd>{pct(selected.closeProbBps)}</dd></div>
                <div><dt>Price points</dt><dd>{priceHistory.length}</dd></div>
              </dl>
              <div className="split">
                <label>
                  Stake ETH
                  <input value={stake} onChange={(event) => setStake(event.target.value)} />
                </label>
                <label>
                  Side
                  <select value={side} onChange={(event) => setSide(Number(event.target.value) as 0 | 1)}>
                    <option value={0}>Commit</option>
                    <option value={1}>Skeptic</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <button onClick={takePosition}><CircleDollarSign size={16} /> Stake</button>
                <button onClick={selfResolve}><Flag size={16} /> Self Resolve</button>
                <button onClick={claim}><BadgeCheck size={16} /> Claim</button>
              </div>
            </>
          ) : (
            <p className="muted">Select or create a pact.</p>
          )}
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
          <button className="wide" onClick={() => refreshProfile()}>Load Profile</button>
          {profile ? (
            <dl className="facts">
              <div><dt>Score</dt><dd>{eth(profile.score)} ETH</dd></div>
              <div><dt>Kept</dt><dd>{profile.kept.toString()}</dd></div>
              <div><dt>Broken</dt><dd>{profile.broken.toString()}</dd></div>
              <div><dt>Staked kept</dt><dd>{eth(profile.stakedKept)} ETH</dd></div>
            </dl>
          ) : null}
        </div>
      </section>

      {message ? <div className="status">{message}</div> : null}
    </main>
  );
}

export default App;
