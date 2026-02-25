"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPublicClient, createWalletClient, custom, http, fallback } from "viem";
import { base } from "viem/chains";

// ═══════════════════════════════════════════════════════════════
// GRIDZERO — Provably Fair Mining (zkVerify × Base)
// Full zk integration: Groth16 VRF → zkVerify → Base settlement
// ═══════════════════════════════════════════════════════════════

const GRIDZERO_ADDR = "0x561e4419bC46ABfC2EBddC536308674A5b6d1D8f";
const ORE_TOKEN_ADDR = "0x5AAA886aEb136F9AaeC967CA988f459639cd8954";
const ZKVERIFY_ATTEST_ADDR = "0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69";

const GRID = 32;
const VISIBLE = 10;
const API_BASE = "/api";

const GRID_ABI = [
  { name: "getCell", type: "function", stateMutability: "view",
    inputs: [{ name: "x", type: "uint8" }, { name: "y", type: "uint8" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "player", type: "address" }, { name: "gridX", type: "uint8" },
      { name: "gridY", type: "uint8" }, { name: "oreType", type: "uint8" },
      { name: "isRare", type: "bool" }, { name: "randomOutput", type: "uint256" },
      { name: "timestamp", type: "uint256" }, { name: "settled", type: "bool" },
    ]}],
  },
  { name: "isMined", type: "function", stateMutability: "view",
    inputs: [{ name: "x", type: "uint8" }, { name: "y", type: "uint8" }],
    outputs: [{ name: "", type: "bool" }],
  },
  { name: "getPlayerStats", type: "function", stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "totalMined", type: "uint256" }, { name: "score", type: "uint256" },
      { name: "oreInventory", type: "uint256[8]" }, { name: "lastMineBlock", type: "uint256" },
    ]}],
  },
  { name: "totalMined", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  { name: "difficultyThreshold", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  { name: "vrfDomainId", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  { name: "getTopPlayers", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address[]" }],
  },
  { name: "getPlayerScore", type: "function", stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  { name: "isSettled", type: "function", stateMutability: "view",
    inputs: [{ name: "x", type: "uint8" }, { name: "y", type: "uint8" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

const ORES = [
  { name: "Stone",   color: "#6a7b8e", glow: "#8a9bae", tier: "Common",    emoji: "◇", score: 1 },
  { name: "Coal",    color: "#4a5a6e", glow: "#6a7b8e", tier: "Common",    emoji: "◆", score: 2 },
  { name: "Iron",    color: "#9aa8b8", glow: "#c0ccd8", tier: "Uncommon",  emoji: "▣", score: 5 },
  { name: "Copper",  color: "#ff6633", glow: "#ff8855", tier: "Uncommon",  emoji: "◈", score: 5 },
  { name: "Silver",  color: "#c0c8d0", glow: "#e0e8f0", tier: "Rare",     emoji: "◎", score: 15 },
  { name: "Gold",    color: "#ff8800", glow: "#ffaa33", tier: "Rare",     emoji: "✦", score: 25 },
  { name: "Diamond", color: "#00b4ff", glow: "#44ccff", tier: "Epic",     emoji: "◆", score: 100 },
  { name: "Mythril", color: "#cc44ff", glow: "#dd77ff", tier: "Legendary", emoji: "✧", score: 500 },
];
const TIER_COL = { Common: "#5a6a7e", Uncommon: "#ff6633", Rare: "#ff8800", Epic: "#00b4ff", Legendary: "#cc44ff" };

const PIPELINE = [
  { id: "generate",  label: "GROTH16 PROOF",    icon: "⚡", desc: "Circom VRF → snarkjs fullProve" },
  { id: "verify",    label: "LOCAL VERIFY",      icon: "◆", desc: "snarkjs groth16.verify" },
  { id: "submit",    label: "ZKVERIFY SUBMIT",   icon: "↗", desc: "Domain #4 → Groth16 verifier" },
  { id: "aggregate", label: "PROOF AGGREGATION", icon: "▦", desc: "16 proofs → Merkle tree" },
  { id: "attest",    label: "BASE ATTESTATION",  icon: "◎", desc: "Root relayed to Base chain" },
  { id: "settle",    label: "ON-CHAIN SETTLE",   icon: "✓", desc: "settleMining() + Merkle proof" },
];

// Public client — we control RPC, not MetaMask
const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://mainnet.base.org", { timeout: 30_000, retryCount: 2, retryDelay: 1000 }),
    http("https://base.drpc.org", { timeout: 30_000, retryCount: 2, retryDelay: 2000 }),
  ]),
});

export default function GridZero() {
  // ─── Wallet State ───
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);

  // ─── Contract State (from Base chain) ───
  const [globalStats, setGlobalStats] = useState({ totalMined: 0, difficulty: 128 });
  const [playerStats, setPlayerStats] = useState(null);
  const [minedCells, setMinedCells] = useState({}); // key: "x,y" → { oreType, isRare, settled, player }
  const [leaderboard, setLeaderboard] = useState([]);

  // ─── Pipeline State ───
  const [mining, setMining] = useState(null); // { x, y } currently mining
  const [stage, setStage] = useState(null);   // current pipeline stage id
  const [stageData, setStageData] = useState({}); // per-stage results (txHashes, etc)
  const [pendingProofs, setPendingProofs] = useState([]); // submitted but not aggregated
  const [settlements, setSettlements] = useState([]); // settlement log

  // ─── UI State ───
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [vpX, setVpX] = useState(0);
  const [vpY, setVpY] = useState(0);
  const [scanLine, setScanLine] = useState(0);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState(null);

  const lastTap = useRef({ x: -1, y: -1, t: 0 });
  const pollRef = useRef(null);

  // ─── CRT Scan Effect ───
  useEffect(() => {
    const iv = setInterval(() => setScanLine(p => (p + 1) % 100), 40);
    return () => clearInterval(iv);
  }, []);

  const addFeed = (msg) => setFeed(p => [{ msg, t: Date.now() }, ...p].slice(0, 40));

  // ═══════════════════════════════════════════════════════════════
  // WALLET CONNECTION (window.ethereum / EIP-1193)
  // ═══════════════════════════════════════════════════════════════
  const connectWallet = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setError("No wallet detected. Install MetaMask or Rabby.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      setAddress(accounts[0]);
      setChainId(parseInt(chain, 16));
      setConnected(true);
      addFeed(`◆ Connected: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`);

      // Switch to Base if needed
      if (parseInt(chain, 16) !== 8453) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }],
          });
          setChainId(8453);
          addFeed("◆ Switched to Base");
        } catch (switchErr) {
          addFeed("⚠ Please switch to Base network");
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const handleAccounts = (accts) => {
      if (accts.length > 0) { setAddress(accts[0]); setConnected(true); }
      else { setAddress(null); setConnected(false); }
    };
    const handleChain = (chain) => setChainId(parseInt(chain, 16));
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccounts);
      window.ethereum.removeListener("chainChanged", handleChain);
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // POLL CONTRACT STATE (uses our publicClient, not wallet RPC)
  // ═══════════════════════════════════════════════════════════════
  const pollState = useCallback(async () => {
    try {
      // Global stats
      const [totalMined, difficulty] = await Promise.all([
        publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "totalMined" }),
        publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "difficultyThreshold" }),
      ]);
      setGlobalStats({ totalMined: Number(totalMined), difficulty: Number(difficulty) });

      // Player stats
      if (address) {
        try {
          const stats = await publicClient.readContract({
            address: GRIDZERO_ADDR, abi: GRID_ABI,
            functionName: "getPlayerStats", args: [address],
          });
          setPlayerStats({
            totalMined: Number(stats.totalMined),
            score: Number(stats.score),
            oreInventory: stats.oreInventory.map(Number),
          });
        } catch (e) {
          // Player hasn't mined yet
          setPlayerStats({ totalMined: 0, score: 0, oreInventory: [0,0,0,0,0,0,0,0] });
        }
      }

      // Viewport cells — batch check mined status
      const calls = [];
      const coords = [];
      for (let y = vpY; y < Math.min(vpY + VISIBLE, GRID); y++) {
        for (let x = vpX; x < Math.min(vpX + VISIBLE, GRID); x++) {
          calls.push({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "isMined", args: [x, y] });
          coords.push({ x, y });
        }
      }
      const minedResults = await publicClient.multicall({ contracts: calls });

      // Fetch details for mined cells
      const detailCalls = [];
      const detailCoords = [];
      minedResults.forEach((r, i) => {
        if (r.result) {
          detailCalls.push({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getCell", args: [coords[i].x, coords[i].y] });
          detailCoords.push(coords[i]);
        }
      });

      if (detailCalls.length > 0) {
        const details = await publicClient.multicall({ contracts: detailCalls });
        const newCells = { ...minedCells };
        details.forEach((d, i) => {
          if (d.result) {
            const c = d.result;
            const { x, y } = detailCoords[i];
            newCells[`${x},${y}`] = {
              oreType: Number(c.oreType),
              isRare: c.isRare,
              settled: c.settled,
              player: c.player,
            };
          }
        });
        setMinedCells(newCells);
      }

      // Leaderboard
      try {
        const top = await publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getTopPlayers" });
        if (top.length > 0) {
          const scoreCalls = top.slice(0, 10).map(a => ({
            address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getPlayerScore", args: [a],
          }));
          const scores = await publicClient.multicall({ contracts: scoreCalls });
          setLeaderboard(top.slice(0, 10).map((a, i) => ({ address: a, score: Number(scores[i]?.result || 0n) })));
        }
      } catch (e) { /* no leaderboard yet */ }

    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [address, vpX, vpY, minedCells]);

  useEffect(() => {
    pollState();
    pollRef.current = setInterval(pollState, 30000);
    return () => clearInterval(pollRef.current);
  }, [pollState]);

  // Re-poll when viewport changes
  useEffect(() => { pollState(); }, [vpX, vpY]);

  // ═══════════════════════════════════════════════════════════════
  // MINING — Full pipeline: proof gen → zkVerify → Base record
  // ═══════════════════════════════════════════════════════════════
  const mine = useCallback(async (x, y) => {
    if (!connected || mining || minedCells[`${x},${y}`]) return;

    setMining({ x, y });
    setStageData({});
    setError(null);
    setSelected(null);
    addFeed(`⛏ Mining cell (${x},${y})...`);

    try {
      // Stage: Generate + Verify + Submit + Record (all in /api/mine)
      setStage("generate");
      addFeed("⚡ Generating Groth16 proof...");

      const res = await fetch(`${API_BASE}/mine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gridX: x, gridY: y, player: address }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Mining failed");
      }

      // Replay stages from API response
      for (const s of data.stages || []) {
        setStage(s.id);
        setStageData(prev => ({ ...prev, [s.id]: s }));
        addFeed(`${s.status === "done" ? "✓" : "✗"} ${s.label} (${s.ms}ms)`);
        await new Promise(r => setTimeout(r, 300)); // brief visual delay
      }

      // Update local state
      const ore = ORES[data.ore.type];
      setMinedCells(prev => ({
        ...prev,
        [`${x},${y}`]: {
          oreType: data.ore.type,
          isRare: data.ore.isRare,
          settled: false,
          player: address,
        },
      }));

      const pts = ore.score * (data.ore.isRare ? 3 : 1);
      addFeed(`${ore.emoji} Found ${ore.name}${data.ore.isRare ? " ★ RARE" : ""} (+${pts})`);

      // Track pending proof for aggregation
      if (data.proof.zkVerifyTxHash) {
        setPendingProofs(prev => [...prev, {
          x, y, txHash: data.proof.zkVerifyTxHash,
          leaf: data.proof.leaf,
          attestationId: data.proof.attestationId,
        }]);
        addFeed(`↗ zkVerify tx: ${data.proof.zkVerifyTxHash?.slice(0, 16)}...`);
      }

      // Show aggregation/attestation stages
      setStage("aggregate");
      addFeed("▦ Proof queued for aggregation (domain #4, fills at 16)");
      await new Promise(r => setTimeout(r, 500));

      setStage("attest");
      addFeed(`◎ Pending attestation → Base (${ZKVERIFY_ATTEST_ADDR.slice(0, 10)}...)`);
      await new Promise(r => setTimeout(r, 500));

      // Settlement will happen when aggregation completes
      setStage("settle");
      addFeed(`◆ Base tx: ${data.base.recordTxHash.slice(0, 16)}... (block ${data.base.blockNumber})`);

      setSettlements(prev => [{
        x, y, ore: ore.name, rare: data.ore.isRare,
        score: pts,
        recordTx: data.base.recordTxHash,
        zkVerifyTx: data.proof.zkVerifyTxHash,
        time: new Date().toLocaleTimeString(),
        totalMs: data.totalMs,
      }, ...prev].slice(0, 50));

      await new Promise(r => setTimeout(r, 600));
      setStage("done");
      addFeed(`✓ Mining complete in ${data.totalMs}ms`);

      // Refresh contract state
      setTimeout(pollState, 1000);

    } catch (err) {
      setError(err.message);
      addFeed(`✗ Error: ${err.message.slice(0, 80)}`);
    }

    await new Promise(r => setTimeout(r, 400));
    setStage(null);
    setMining(null);
  }, [connected, mining, minedCells, address, pollState]);

  // ─── Cell interaction ───
  const handleCellClick = (x, y) => {
    if (!connected || mining || minedCells[`${x},${y}`]) return;
    const now = Date.now();
    const lt = lastTap.current;
    if (lt.x === x && lt.y === y && now - lt.t < 400) {
      mine(x, y);
      lastTap.current = { x: -1, y: -1, t: 0 };
    } else {
      setSelected({ x, y });
      lastTap.current = { x, y, t: now };
    }
  };

  const vw = Math.min(VISIBLE, GRID - vpX);
  const vh = Math.min(VISIBLE, GRID - vpY);
  const score = playerStats?.score || 0;
  const totalPlayerMined = playerStats?.totalMined || 0;
  const inventory = playerStats?.oreInventory || [0,0,0,0,0,0,0,0];
  const rareCount = Object.values(minedCells).filter(c => c.isRare && c.player?.toLowerCase() === address?.toLowerCase()).length;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={S.root} suppressHydrationWarning>
      <style suppressHydrationWarning>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #0a0c0f; }
        ::-webkit-scrollbar-thumb { background: #1a2030; border-radius: 3px; }
        @keyframes glow { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes slideIn { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes scanGlow { 0%,100% { text-shadow: 0 0 4px rgba(255,136,0,0.3); } 50% { text-shadow: 0 0 12px rgba(255,136,0,0.7); } }
        @keyframes miningPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.95); } }
        @keyframes cellAppear { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes rareGlow { 0%,100% { box-shadow: 0 0 6px rgba(255,200,0,0.25); } 50% { box-shadow: 0 0 16px rgba(255,200,0,0.6), inset 0 0 6px rgba(255,200,0,0.1); } }
      `}</style>

      {/* CRT overlays */}
      <div style={{ ...S.scanOverlay, background: `linear-gradient(180deg, transparent ${scanLine-2}%, rgba(255,136,0,0.1) ${scanLine-1}%, rgba(255,136,0,0.3) ${scanLine}%, rgba(255,136,0,0.1) ${scanLine+1}%, transparent ${scanLine+2}%)` }} />
      <div style={S.crtLines} />

      {/* ─── HEADER ─── */}
      <header style={S.header}>
        <div style={S.hLeft}>
          <span style={S.dot} />
          <span style={S.logo}>GRID</span>
          <span style={S.logoSub}>ZERO</span>
          <span style={S.badge}>MAINNET</span>
          {chainId && chainId !== 8453 && <span style={{ ...S.badge, color: "#ff3355", background: "rgba(255,51,85,0.12)" }}>WRONG CHAIN</span>}
        </div>
        <div style={S.hRight}>
          <span style={S.hStat}>GRID <b style={{ color: "#e0e8f0" }}>{globalStats.totalMined}/{GRID*GRID}</b></span>
          {connected && playerStats && (
            <span style={S.hStat}>SCORE <b style={{ color: "#ff8800" }}>{score.toLocaleString()}</b></span>
          )}
          {!connected ? (
            <button style={S.loginBtn} onClick={connectWallet}>⚡ CONNECT</button>
          ) : (
            <button style={S.loginBtn} onClick={() => { setConnected(false); setAddress(null); }}>
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "DISCONNECT"}
            </button>
          )}
        </div>
      </header>

      {/* ─── MAIN ─── */}
      <div style={S.main}>
        {/* ─── GRID AREA ─── */}
        <div style={S.gridArea}>
          {/* Stats row */}
          <div style={S.statsRow}>
            {[
              { label: "MINED", value: totalPlayerMined },
              { label: "SCORE", value: score.toLocaleString(), hl: true },
              { label: "RARE", value: rareCount },
              { label: "SETTLED", value: settlements.length },
            ].map((s, i) => (
              <div key={i} style={S.statItem}>
                <span style={S.statLabel}>{s.label}</span>
                <span style={{ ...S.statValue, ...(s.hl ? { color: "#ff8800" } : {}) }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Navigation */}
          <div style={S.navRow}>
            <span style={{ fontSize: 10, color: "#4a5a6e", letterSpacing: 1.5 }}>
              SECTOR ({vpX},{vpY}) — ({vpX+vw-1},{vpY+vh-1})
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {[["◀", () => setVpX(v => Math.max(0, v-4))], ["▶", () => setVpX(v => Math.min(GRID-VISIBLE, v+4))], ["▲", () => setVpY(v => Math.max(0, v-4))], ["▼", () => setVpY(v => Math.min(GRID-VISIBLE, v+4))]].map(([l, fn], i) => (
                <button key={i} onClick={fn} style={S.navBtn}>{l}</button>
              ))}
            </div>
          </div>

          {/* Grid with corner brackets */}
          <div style={S.gridOuter}>
            <div style={S.cornerTL} /><div style={S.cornerTR} />
            <div style={S.cornerBL} /><div style={S.cornerBR} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${vw}, 1fr)`, gap: 4, width: "100%" }}>
              {Array.from({ length: vh }).map((_, ry) =>
                Array.from({ length: vw }).map((_, rx) => {
                  const x = vpX + rx, y = vpY + ry, key = `${x},${y}`;
                  const m = minedCells[key];
                  const isMining = mining?.x === x && mining?.y === y;
                  const isSel = selected?.x === x && selected?.y === y;
                  const isHov = hovered?.x === x && hovered?.y === y;
                  const isMine = m?.player?.toLowerCase() === address?.toLowerCase();

                  let bg = "rgba(255,136,0,0.02)", border = "rgba(255,136,0,0.08)", content = null, anim = "cellAppear 0.3s ease both", extra = {};

                  if (isMining) {
                    bg = "rgba(255,136,0,0.15)"; border = "rgba(255,136,0,0.5)";
                    content = <span style={{ fontSize: 15, animation: "pulse 0.4s infinite" }}>⛏</span>;
                    anim = "miningPulse 0.4s infinite";
                  } else if (m) {
                    const o = ORES[m.oreType];
                    bg = m.isRare ? `${o.color}18` : `${o.color}0c`;
                    border = m.settled ? `${o.color}55` : m.isRare ? `${o.color}40` : `${o.color}20`;
                    content = (
                      <>
                        <span style={{ fontSize: 14, color: o.color, textShadow: m.isRare ? `0 0 8px ${o.glow}` : "none" }}>{o.emoji}</span>
                        {m.settled && <span style={{ fontSize: 6, color: "#ff8800", position: "absolute", top: 2, right: 3 }}>✓</span>}
                        {isMine && <span style={{ fontSize: 6, color: "#00b4ff", position: "absolute", top: 2, left: 3 }}>●</span>}
                      </>
                    );
                    if (m.isRare) anim = "rareGlow 2s infinite";
                  } else if (isSel) {
                    bg = "rgba(0,180,255,0.12)"; border = "rgba(0,180,255,0.5)";
                    content = <span style={{ fontSize: 12, color: "#00b4ff" }}>⛏</span>;
                    extra = { boxShadow: "0 0 15px rgba(0,180,255,0.3)" };
                  } else if (isHov && connected) {
                    bg = "rgba(255,136,0,0.06)"; border = "rgba(255,136,0,0.35)";
                    extra = { transform: "translateY(-2px) scale(1.02)", boxShadow: "0 4px 12px rgba(255,136,0,0.12)" };
                  }

                  return (
                    <button key={key} onClick={() => handleCellClick(x, y)}
                      onMouseEnter={() => setHovered({ x, y })} onMouseLeave={() => setHovered(null)}
                      style={{
                        fontFamily: "'JetBrains Mono', monospace", position: "relative",
                        aspectRatio: "1", border: `1px solid ${border}`, borderRadius: 5,
                        background: bg, cursor: !m && connected ? "pointer" : "default",
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: 1, transition: "all 0.15s ease",
                        animation: anim, animationDelay: `${ry * 0.04}s`,
                        outline: "none", padding: 0, ...extra,
                      }}>
                      {content || <span style={{ fontSize: 8, color: "#2a3a4e", letterSpacing: 1 }}>{String.fromCharCode(65+(y%26))}{x}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Status bar */}
          <div style={S.statusBar}>
            <span style={{ fontWeight: 600, letterSpacing: 1.5, color: connected ? "#ff8800" : "#4a5a6e" }}>
              {!connected ? "CONNECT WALLET" : mining ? `MINING (${mining.x},${mining.y})...` : stage && stage !== "done" ? PIPELINE.find(p => p.id === stage)?.label || "PROCESSING..." : "READY"}
            </span>
            <span style={{ color: "#4a5a6e" }}>DIFF: {globalStats.difficulty}</span>
          </div>

          {/* Claim button */}
          {selected && !mining && connected && !stage && (
            <button style={S.claimBtn} onClick={() => mine(selected.x, selected.y)}>
              ⛏ MINE ({selected.x},{selected.y}) — GENERATE VRF PROOF
            </button>
          )}
          {mining && (
            <div style={S.claimingBar}>
              <div style={S.claimingDot} />
              {stage && PIPELINE.find(p => p.id === stage)
                ? `${PIPELINE.find(p => p.id === stage).icon} ${PIPELINE.find(p => p.id === stage).label}...`
                : "PROCESSING..."
              }
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={S.errorBox} onClick={() => setError(null)}>
              ✗ {error} <span style={{ opacity: 0.5, fontSize: 9 }}>(tap to dismiss)</span>
            </div>
          )}

          {/* Minimap */}
          <div style={{ width: "100%", maxWidth: 560, marginTop: 6 }}>
            <div style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>GRID MAP</div>
            <div style={{ width: 120, aspectRatio: "1", background: "rgba(10,14,20,0.8)", border: "1px solid rgba(255,136,0,0.1)", borderRadius: 6, position: "relative", overflow: "hidden" }}>
              {Object.entries(minedCells).map(([k, v]) => {
                const [cx, cy] = k.split(",").map(Number);
                return <div key={k} style={{ position: "absolute", left: `${(cx/GRID)*100}%`, top: `${(cy/GRID)*100}%`, width: `${100/GRID}%`, height: `${100/GRID}%`, background: ORES[v.oreType].color, opacity: v.isRare ? 1 : 0.5 }} />;
              })}
              <div style={{ position: "absolute", left: `${(vpX/GRID)*100}%`, top: `${(vpY/GRID)*100}%`, width: `${(VISIBLE/GRID)*100}%`, height: `${(VISIBLE/GRID)*100}%`, border: "1px solid #ff8800", borderRadius: 1 }} />
            </div>
          </div>

          <div style={{ fontSize: 10, letterSpacing: 1.5, color: "#3a4a5e", textAlign: "center", padding: "6px 0" }}>
            ◆ TAP TO SELECT · DOUBLE-TAP TO MINE ◆
          </div>
        </div>

        {/* ─── SIDEBAR ─── */}
        <div style={S.sidebar}>
          {/* Pipeline */}
          <Panel title="PROOF PIPELINE" live={!!stage && stage !== "done"}>
            {PIPELINE.map((p, i) => {
              const active = stage === p.id;
              const past = stage && PIPELINE.findIndex(s => s.id === stage) > i;
              const done = stage === "done";
              const data = stageData[p.id];
              return (
                <div key={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", opacity: active ? 1 : past || done ? 0.45 : 0.15, transition: "opacity 0.3s" }}>
                    <span style={{ fontSize: 13, width: 18, textAlign: "center", color: active ? "#ff8800" : data?.status === "error" ? "#ff3355" : "#6a7b8e" }}>
                      {data?.status === "error" ? "✗" : past || done ? "✓" : active ? p.icon : "○"}
                    </span>
                    <span style={{ fontSize: 11, letterSpacing: 1, color: active ? "#ff8800" : "#8a9bae", fontWeight: active ? 700 : 400, animation: active ? "scanGlow 2s infinite" : "none" }}>{p.label}</span>
                    {data?.ms && <span style={{ fontSize: 9, color: "#3a4a5e", marginLeft: "auto" }}>{data.ms}ms</span>}
                    {active && !data && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff8800", boxShadow: "0 0 6px #ff880088", marginLeft: "auto", animation: "glow 1.5s infinite" }} />}
                  </div>
                  {data?.txHash && (
                    <div style={{ fontSize: 9, color: "#3a4a5e", marginLeft: 28, marginBottom: 2 }}>
                      tx: {data.txHash.slice(0, 18)}...
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ borderTop: "1px solid rgba(255,136,0,0.06)", marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1 }}>
                PENDING PROOFS: <b style={{ color: "#ff8800" }}>{pendingProofs.length}</b> / 16
              </div>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1 }}>
                AGGREGATION DOMAIN: <b style={{ color: "#ff8800" }}>#4</b>
              </div>
            </div>
          </Panel>

          {/* Inventory (from contract) */}
          <Panel title="INVENTORY">
            {ORES.map((ore, i) => {
              const count = inventory[i] || 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", opacity: count > 0 ? 1 : 0.25 }}>
                  <span style={{ fontSize: 13, width: 18, textAlign: "center", color: ore.color }}>{ore.emoji}</span>
                  <span style={{ flex: 1, fontSize: 11, color: count > 0 ? ore.color : "#3a4a5e", letterSpacing: 0.5 }}>{ore.name}</span>
                  <span style={{ fontSize: 9, color: TIER_COL[ore.tier], letterSpacing: 1 }}>{ore.tier.slice(0,4).toUpperCase()}</span>
                  <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: count > 0 ? "#e0e8f0" : "#1a2030", minWidth: 28, textAlign: "right" }}>{count}</span>
                </div>
              );
            })}
          </Panel>

          {/* Deployment */}
          <Panel title="CONTRACTS">
            {[
              { l: "GridZero", v: "0x561e...1D8f" },
              { l: "OreToken", v: "0x5AAA...8954" },
              { l: "zkAttest", v: "0xCb47...2b69" },
            ].map((r, i) => <Row key={i} label={r.l} value={r.v} />)}
            <div style={{ borderTop: "1px solid rgba(255,136,0,0.06)", marginTop: 6, paddingTop: 6 }}>
              {[
                { l: "VRF Domain", v: "#4", hl: true },
                { l: "LB Domain", v: "#5", hl: true },
                { l: "Diff Domain", v: "#6", hl: true },
                { l: "Chain", v: "Base (8453)" },
                { l: "VRF Circuit", v: "1,654 R1CS" },
                { l: "Vkey Hash", v: "0x422e...69f5" },
              ].map((r, i) => <Row key={i} label={r.l} value={r.v} hl={r.hl} />)}
            </div>
          </Panel>

          {/* zkVerify Features */}
          <Panel title="ZKVERIFY FEATURES">
            {[
              ["Groth16 Verification", "VRF mining proofs via Circom"],
              ["RISC Zero Verification", "Leaderboard integrity proofs"],
              ["EZKL Verification", "ML difficulty adjustment"],
              ["Domain Management", "3 domains: VRF, LB, Diff"],
              ["VK Registration", "On-chain verification keys"],
              ["Batch Verification", "batchSettleMining()"],
              ["Proof Aggregation", "16/4/2 per domain"],
              ["Aggregation Receipts", "NewAggregationReceipt events"],
              ["Cross-chain Attestation", "zkVerify → Base relay"],
              ["Event Subscription", "Real-time proof tracking"],
              ["Optimistic Verification", "Pre-settlement mining"],
              ["Merkle Path Proofs", "On-chain inclusion verification"],
            ].map(([f, d], i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0", fontSize: 10, color: "#6a7b8e" }}>
                <span style={{ color: "#ff6633", fontSize: 7, marginTop: 3 }}>●</span>
                <div>
                  <span style={{ color: "#8a9bae" }}>{f}</span>
                  <div style={{ fontSize: 8, color: "#3a4a5e", marginTop: 1 }}>{d}</div>
                </div>
              </div>
            ))}
          </Panel>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <Panel title="LEADERBOARD">
              {leaderboard.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 11 }}>
                  <span style={{ color: i === 0 ? "#ff8800" : i === 1 ? "#c0c8d0" : i === 2 ? "#ff6633" : "#4a5a6e", fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700, width: 22 }}>#{i+1}</span>
                  <span style={{ flex: 1, color: p.address.toLowerCase() === address?.toLowerCase() ? "#00b4ff" : "#7a8b9e", fontSize: 10 }}>
                    {p.address.slice(0, 6)}...{p.address.slice(-4)}
                  </span>
                  <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: "#e0e8f0" }}>{p.score.toLocaleString()}</span>
                </div>
              ))}
            </Panel>
          )}

          {/* Activity Feed */}
          <Panel title="ACTIVITY" live>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {feed.length === 0 ? (
                <div style={{ color: "#2a3a4e", fontSize: 11, fontStyle: "italic", padding: "8px 0" }}>Waiting for activity...</div>
              ) : feed.map((f, i) => (
                <div key={f.t + "-" + i} style={{ fontSize: 10, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", gap: 8, animation: i === 0 ? "slideIn 0.3s ease" : "none" }}>
                  <span style={{ color: "#2a3a4e", fontSize: 9, flexShrink: 0 }}>{new Date(f.t).toLocaleTimeString().slice(0,-3)}</span>
                  <span style={{ color: "#7a8b9e" }}>{f.msg}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Settlement Log */}
          {settlements.length > 0 && (
            <Panel title="SETTLEMENTS">
              <div style={{ maxHeight: 160, overflowY: "auto" }}>
                {settlements.slice(0, 20).map((e, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 10, borderBottom: "1px solid rgba(255,255,255,0.03)", animation: i === 0 ? "slideIn 0.3s ease" : "none" }}>
                    <span style={{ color: "#2a3a4e", width: 50 }}>{e.time.slice(0,-3)}</span>
                    <span style={{ color: "#4a5a6e" }}>({e.x},{e.y})</span>
                    <span style={{ color: ORES.find(o => o.name === e.ore)?.color || "#6a7b8e" }}>{e.ore}</span>
                    {e.rare && <span style={{ color: "#ff8800" }}>★</span>}
                    <span style={{ color: "#3a4a5e", fontSize: 8 }}>{e.totalMs}ms</span>
                    <span style={{ color: "#ff8800", marginLeft: "auto", fontFamily: "'Orbitron', sans-serif", fontSize: 10 }}>+{e.score}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* ─── FOOTER ─── */}
      <footer style={S.footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ff8800", boxShadow: "0 0 6px #ff880088" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#ff8800", letterSpacing: 1.5, animation: "scanGlow 3s infinite" }}>GRID ONLINE</span>
        </div>
        <span style={{ fontSize: 10, color: "#3a4a5e", letterSpacing: 1 }}>ZKVERIFY × BASE × GROTH16 × RISC0 × EZKL</span>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Panel({ title, live, children }) {
  return (
    <div style={S.panel}>
      <div style={S.panelHead}>
        <span>{title}</span>
        {live && <span style={S.liveTag}>● LIVE</span>}
      </div>
      <div style={{ padding: "8px 14px" }}>{children}</div>
    </div>
  );
}
function Row({ label, value, hl }) {
  return (
    <div style={S.row}>
      <span style={S.rowLabel}>{label}</span>
      <span style={{ ...S.rowValue, ...(hl ? { color: "#ff8800" } : {}) }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = {
  root: { fontFamily: "'JetBrains Mono', monospace", background: "radial-gradient(ellipse at 30% 20%, #0f1923 0%, #0a0c0f 50%, #080a0d 100%)", color: "#c8d6e5", minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" },
  scanOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 50, transition: "background 0.04s linear" },
  crtLines: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 49, background: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid rgba(255,136,0,0.12)", background: "rgba(10,12,15,0.95)", zIndex: 10, position: "relative" },
  hLeft: { display: "flex", alignItems: "center", gap: 8 },
  hRight: { display: "flex", alignItems: "center", gap: 14 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#ff6633", boxShadow: "0 0 8px #ff663388" },
  logo: { fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 20, color: "#ff6633", letterSpacing: 2 },
  logoSub: { fontFamily: "'Orbitron', sans-serif", fontWeight: 500, fontSize: 20, color: "#e0e8f0", letterSpacing: 2 },
  badge: { fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(255,136,0,0.12)", color: "#ff8800", letterSpacing: 1.5, fontWeight: 600 },
  hStat: { fontSize: 11, color: "#5a6a7e", letterSpacing: 0.5 },
  loginBtn: { fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700, padding: "8px 16px", borderRadius: 6, border: "1px solid #ff8800", background: "linear-gradient(135deg, rgba(255,136,0,0.15), rgba(255,136,0,0.05))", color: "#ff8800", cursor: "pointer", letterSpacing: 1.5 },
  main: { display: "flex", flex: 1, position: "relative", zIndex: 5 },
  gridArea: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 24px", gap: 10, overflowY: "auto" },
  statsRow: { display: "flex", gap: 1, width: "100%", maxWidth: 560, background: "rgba(10,14,20,0.6)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,136,0,0.08)" },
  statItem: { flex: 1, padding: "10px 14px", borderRight: "1px solid rgba(255,136,0,0.06)", display: "flex", flexDirection: "column", gap: 2 },
  statLabel: { fontSize: 9, letterSpacing: 2, color: "#4a5a6e", fontWeight: 700 },
  statValue: { fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 700, color: "#e0e8f0" },
  navRow: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 560 },
  navBtn: { width: 30, height: 30, borderRadius: 5, fontSize: 12, background: "rgba(255,136,0,0.04)", border: "1px solid rgba(255,136,0,0.15)", color: "#6a7b8e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  gridOuter: { position: "relative", width: "100%", maxWidth: 560, padding: 12 },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 20, height: 20, borderLeft: "2px solid rgba(255,136,0,0.4)", borderTop: "2px solid rgba(255,136,0,0.4)" },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 20, height: 20, borderRight: "2px solid rgba(255,136,0,0.4)", borderTop: "2px solid rgba(255,136,0,0.4)" },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 20, height: 20, borderLeft: "2px solid rgba(255,136,0,0.4)", borderBottom: "2px solid rgba(255,136,0,0.4)" },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderRight: "2px solid rgba(255,136,0,0.4)", borderBottom: "2px solid rgba(255,136,0,0.4)" },
  statusBar: { display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 560, padding: "6px 12px", fontSize: 11, letterSpacing: 1.5, color: "#4a5a6e" },
  claimBtn: { fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700, padding: "14px 20px", borderRadius: 8, width: "100%", maxWidth: 560, border: "1px solid #ff8800", background: "linear-gradient(135deg, rgba(255,136,0,0.15), rgba(255,136,0,0.05))", color: "#ff8800", cursor: "pointer", letterSpacing: 1, textAlign: "center" },
  claimingBar: { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 8, border: "1px solid rgba(255,170,0,0.3)", background: "rgba(255,170,0,0.08)", color: "#ffaa00", fontSize: 11, fontWeight: 600, letterSpacing: 1, width: "100%", maxWidth: 560 },
  claimingDot: { width: 8, height: 8, borderRadius: "50%", background: "#ffaa00", animation: "pulse 1s infinite" },
  errorBox: { padding: "10px 14px", borderRadius: 6, border: "1px solid rgba(255,51,85,0.3)", background: "rgba(255,51,85,0.08)", color: "#ff3355", fontSize: 11, cursor: "pointer", width: "100%", maxWidth: 560 },
  sidebar: { width: 340, minWidth: 300, borderLeft: "1px solid rgba(255,136,0,0.08)", background: "rgba(10,14,20,0.98)", padding: 14, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: "calc(100vh - 90px)" },
  panel: { border: "1px solid rgba(255,136,0,0.1)", borderRadius: 8, background: "rgba(255,136,0,0.02)", overflow: "hidden" },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#7a8b9e", borderBottom: "1px solid rgba(255,136,0,0.06)" },
  liveTag: { color: "#ff8800", fontSize: 10, letterSpacing: 1, animation: "scanGlow 2s infinite" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 11 },
  rowLabel: { color: "#5a6a7e", letterSpacing: 0.5 },
  rowValue: { fontWeight: 600, color: "#c0ccd8", fontFamily: "'Orbitron', sans-serif", fontSize: 12 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderTop: "1px solid rgba(255,136,0,0.08)", background: "rgba(10,12,15,0.95)", zIndex: 10, position: "relative" },
};
