"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createWalletClient, custom, formatUnits, parseUnits } from "viem";
import { base } from "viem/chains";
import {
  publicClient, GRIDZERO_V3_ADDR, ZERO_TOKEN_ADDR, USDC_ADDR,
  GRIDZERO_V3_ABI, ERC20_ABI, SUPABASE_URL, SUPABASE_ANON_KEY,
} from "@/lib/chain";

// ═══════════════════════════════════════════════════════════════
// GRIDZERO V3 — Round-Based Betting Game
// 5x5 Grid · 30s Rounds · USDC Entry · Real Groth16 VRF
// ═══════════════════════════════════════════════════════════════

const GRID = 5;
const BASESCAN = "https://basescan.org";

// Supabase REST helper (read-only, anon key)
async function supaGet(endpoint) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function shortAddr(a) {
  if (!a) return "—";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function fmtUsdc(raw) {
  if (!raw && raw !== 0 && raw !== "0") return "0";
  const n = Number(raw) / 1e6;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeSince(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function GridZeroV3() {
  // Wallet
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [usdcBalance, setUsdcBalance] = useState(0n);

  // Round state (from contract)
  const [roundId, setRoundId] = useState(0n);
  const [roundData, setRoundData] = useState(null);
  const [cellCounts, setCellCounts] = useState(new Array(25).fill(0));
  const [timeLeft, setTimeLeft] = useState(0);
  const [entryFee, setEntryFee] = useState(1000000n); // 1 USDC default
  const [hasJoined, setHasJoined] = useState(false);
  const [myCell, setMyCell] = useState(null);

  // Unclaimed wins
  const [unclaimedRounds, setUnclaimedRounds] = useState([]);

  // Supabase data
  const [recentRounds, setRecentRounds] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  // UI state
  const [tab, setTab] = useState("rounds"); // rounds | history | leaderboard
  const [hoveredCell, setHoveredCell] = useState(null);
  const [picking, setPicking] = useState(false);
  const [claiming, setClaiming] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const timerRef = useRef(null);
  const pollRef = useRef(null);

  const addFeed = (msg) => setFeed((p) => [{ msg, t: Date.now() }, ...p].slice(0, 30));

  // ═══════════════════════════════════════════════════════════════
  // WALLET
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
      addFeed(`Connected: ${shortAddr(accounts[0])}`);
      if (parseInt(chain, 16) !== 8453) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }],
          });
          setChainId(8453);
        } catch { addFeed("Switch to Base network"); }
      }
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const handleAccounts = (a) => { if (a.length > 0) { setAddress(a[0]); setConnected(true); } else { setAddress(null); setConnected(false); } };
    const handleChain = (c) => setChainId(parseInt(c, 16));
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => { window.ethereum.removeListener("accountsChanged", handleAccounts); window.ethereum.removeListener("chainChanged", handleChain); };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // POLL CONTRACT STATE
  // ═══════════════════════════════════════════════════════════════
  const pollContract = useCallback(async () => {
    try {
      const [currentRound, fee] = await Promise.all([
        publicClient.readContract({ address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "getCurrentRound" }),
        publicClient.readContract({ address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "entryFee" }),
      ]);

      const [rid, startTime, endTime, totalDeposits, totalPlayers, remaining] = currentRound;
      const prevRoundId = roundId;

      setRoundId(rid);
      setEntryFee(fee);
      setTimeLeft(Number(remaining));
      setRoundData({ startTime: Number(startTime), endTime: Number(endTime), totalDeposits, totalPlayers: Number(totalPlayers) });

      // Cell counts
      const counts = await publicClient.readContract({
        address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "getCellCounts", args: [rid],
      });
      setCellCounts(counts.map(Number));

      // If round changed, check if previous round result is available
      if (prevRoundId > 0n && rid > prevRoundId) {
        try {
          const prevRound = await publicClient.readContract({
            address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "rounds", args: [prevRoundId],
          });
          if (prevRound[5]) { // resolved
            setLastResult({
              roundId: Number(prevRoundId),
              winningCell: Number(prevRound[4]),
              isBonus: prevRound[6],
              totalPlayers: Number(prevRound[3]),
            });
            addFeed(`Round ${prevRoundId} resolved → cell (${Math.floor(Number(prevRound[4]) / 5)},${Number(prevRound[4]) % 5})${prevRound[6] ? " MOTHERLODE!" : ""}`);
          }
        } catch {}
        // Reset joined state for new round
        setHasJoined(false);
        setMyCell(null);
      }

      // Check if current user joined
      if (address) {
        const joined = await publicClient.readContract({
          address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "hasJoined", args: [rid, address],
        });
        setHasJoined(joined);
        if (joined) {
          const cellVal = await publicClient.readContract({
            address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "playerCell", args: [rid, address],
          });
          setMyCell(Number(cellVal) - 1); // playerCell stores cell+1
        }

        // USDC balance
        const bal = await publicClient.readContract({
          address: USDC_ADDR, abi: ERC20_ABI, functionName: "balanceOf", args: [address],
        });
        setUsdcBalance(bal);
      }
    } catch (err) {
      console.warn("Poll error:", err.message);
    }
  }, [address, roundId]);

  // Poll every 2 seconds
  useEffect(() => {
    pollContract();
    pollRef.current = setInterval(pollContract, 2000);
    return () => clearInterval(pollRef.current);
  }, [pollContract]);

  // Countdown timer (every 1 second, locally)
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // CHECK UNCLAIMED WINS (from Supabase)
  // ═══════════════════════════════════════════════════════════════
  const checkUnclaimed = useCallback(async () => {
    if (!address) return;
    const rows = await supaGet(
      `gz_round_players?player_address=eq.${address.toLowerCase()}&is_winner=eq.true&claimed=eq.false&select=round_id`
    );
    if (rows.length > 0) {
      // Verify on-chain that they haven't claimed
      const unclaimed = [];
      for (const row of rows) {
        try {
          const claimed = await publicClient.readContract({
            address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "hasClaimed",
            args: [BigInt(row.round_id), address],
          });
          if (!claimed) unclaimed.push(row.round_id);
        } catch {}
      }
      setUnclaimedRounds(unclaimed);
    } else {
      setUnclaimedRounds([]);
    }
  }, [address]);

  // ═══════════════════════════════════════════════════════════════
  // FETCH SUPABASE DATA
  // ═══════════════════════════════════════════════════════════════
  const fetchSupabase = useCallback(async () => {
    const rounds = await supaGet("gz_recent_rounds?order=round_id.desc&limit=50");
    setRecentRounds(rounds);

    if (address) {
      const history = await supaGet(
        `gz_user_history?player_address=eq.${address.toLowerCase()}&order=round_id.desc&limit=50`
      );
      setUserHistory(history);
      checkUnclaimed();
    }

    const lb = await supaGet("gz_leaderboard?order=total_wins.desc&limit=20");
    setLeaderboard(lb);
  }, [address, checkUnclaimed]);

  useEffect(() => {
    fetchSupabase();
    const iv = setInterval(fetchSupabase, 10000);
    return () => clearInterval(iv);
  }, [fetchSupabase]);

  // ═══════════════════════════════════════════════════════════════
  // PICK CELL (approve USDC if needed, then pickCell)
  // ═══════════════════════════════════════════════════════════════
  const handlePickCell = async (cell) => {
    if (!connected || hasJoined || picking || timeLeft <= 0) return;
    setPicking(true);
    setError(null);

    try {
      const walletClient = createWalletClient({
        account: address, chain: base,
        transport: custom(window.ethereum),
      });

      // Check USDC allowance
      const allowance = await publicClient.readContract({
        address: USDC_ADDR, abi: ERC20_ABI, functionName: "allowance",
        args: [address, GRIDZERO_V3_ADDR],
      });

      if (allowance < entryFee) {
        addFeed("Approving USDC...");
        const approveTx = await walletClient.writeContract({
          address: USDC_ADDR, abi: ERC20_ABI, functionName: "approve",
          args: [GRIDZERO_V3_ADDR, parseUnits("1000000", 6)], // Approve max
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        addFeed("USDC approved");
      }

      // Pick cell
      addFeed(`Picking cell (${Math.floor(cell / 5)},${cell % 5})...`);
      const tx = await walletClient.writeContract({
        address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "pickCell",
        args: [cell],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addFeed(`Picked cell (${Math.floor(cell / 5)},${cell % 5})`);
      setHasJoined(true);
      setMyCell(cell);
      pollContract();
    } catch (err) {
      const msg = err?.shortMessage || err?.message || "Transaction failed";
      setError(msg);
      addFeed(`Error: ${msg}`);
    } finally {
      setPicking(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // CLAIM WINNINGS
  // ═══════════════════════════════════════════════════════════════
  const handleClaim = async (claimRoundId) => {
    if (!connected || claiming) return;
    setClaiming(claimRoundId);
    setError(null);

    try {
      const walletClient = createWalletClient({
        account: address, chain: base,
        transport: custom(window.ethereum),
      });
      addFeed(`Claiming round ${claimRoundId}...`);
      const tx = await walletClient.writeContract({
        address: GRIDZERO_V3_ADDR, abi: GRIDZERO_V3_ABI, functionName: "claim",
        args: [BigInt(claimRoundId)],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addFeed(`Claimed round ${claimRoundId}!`);
      setUnclaimedRounds((prev) => prev.filter((r) => r !== claimRoundId));
      fetchSupabase();
    } catch (err) {
      const msg = err?.shortMessage || err?.message || "Claim failed";
      setError(msg);
    } finally {
      setClaiming(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  const totalOnGrid = cellCounts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...cellCounts, 1);
  const timerPct = roundData ? Math.max(0, timeLeft / 30) : 0;
  const isExpired = timeLeft <= 0;

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0e14", color: "#c0ccd8",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      padding: "16px", boxSizing: "border-box",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 4px #ff880066; } 50% { box-shadow: 0 0 12px #ff8800cc; } }
        @keyframes winGlow { 0%, 100% { box-shadow: 0 0 8px #00ff8866; } 50% { box-shadow: 0 0 24px #00ff88cc; } }
        @keyframes bonusGlow { 0%, 100% { box-shadow: 0 0 8px #cc44ff66; } 50% { box-shadow: 0 0 24px #cc44ffcc; } }
        * { scrollbar-width: thin; scrollbar-color: #1a2030 #0a0e14; }
      `}</style>

      {/* ─── HEADER ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{
            fontFamily: "'Orbitron', sans-serif", fontSize: 22, fontWeight: 900,
            color: "#ff8800", margin: 0, letterSpacing: 2,
            textShadow: "0 0 20px #ff880044",
          }}>
            GRIDZERO
          </h1>
          <span style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            background: "#ff880015", border: "1px solid #ff880033", color: "#ff8800",
            fontWeight: 600, letterSpacing: 1,
          }}>V3</span>
        </div>

        {connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11 }}>
            <span style={{ color: "#6a7b8e" }}>
              {fmtUsdc(usdcBalance.toString())} <span style={{ color: "#3a4a5e" }}>USDC</span>
            </span>
            <span style={{
              padding: "4px 10px", borderRadius: 4,
              background: "#0d1520", border: "1px solid #1a2535", color: "#8a9bae",
            }}>
              {shortAddr(address)}
            </span>
          </div>
        ) : (
          <button onClick={connectWallet} style={{
            fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
            padding: "8px 20px", borderRadius: 4, border: "1px solid #ff880044",
            background: "#ff880015", color: "#ff8800", cursor: "pointer",
            letterSpacing: 1,
          }}>
            CONNECT
          </button>
        )}
      </div>

      {/* ─── ERROR ─── */}
      {error && (
        <div style={{
          padding: "8px 12px", marginBottom: 12, borderRadius: 4,
          background: "#ff333310", border: "1px solid #ff333333", color: "#ff6666",
          fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{error}</span>
          <span onClick={() => setError(null)} style={{ cursor: "pointer", color: "#ff333366" }}>✕</span>
        </div>
      )}

      {/* ─── UNCLAIMED WINS BANNER ─── */}
      {unclaimedRounds.length > 0 && (
        <div style={{
          padding: "10px 14px", marginBottom: 12, borderRadius: 4,
          background: "#00ff8810", border: "1px solid #00ff8833",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
        }}>
          <span style={{ color: "#00ff88", fontSize: 12, fontWeight: 600 }}>
            You have {unclaimedRounds.length} unclaimed win{unclaimedRounds.length > 1 ? "s" : ""}!
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {unclaimedRounds.map((rid) => (
              <button key={rid} onClick={() => handleClaim(rid)} disabled={claiming !== null}
                style={{
                  fontSize: 10, padding: "4px 10px", borderRadius: 3,
                  background: claiming === rid ? "#1a2030" : "#00ff8820",
                  border: "1px solid #00ff8844", color: "#00ff88",
                  cursor: claiming ? "wait" : "pointer", fontWeight: 600,
                }}>
                {claiming === rid ? "CLAIMING..." : `CLAIM R${rid}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── MAIN LAYOUT ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, maxWidth: 900, margin: "0 auto" }}>

        {/* LEFT: Round + Grid */}
        <div>
          {/* Round Info Bar */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 14px", borderRadius: 4, marginBottom: 12,
            background: "#0d1520", border: "1px solid #1a2535",
          }}>
            <div>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1, marginBottom: 2 }}>ROUND</div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 700, color: "#e0e8f0" }}>
                #{roundId.toString()}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1, marginBottom: 2 }}>TIME LEFT</div>
              <div style={{
                fontFamily: "'Orbitron', sans-serif", fontSize: 22, fontWeight: 900,
                color: timeLeft <= 5 ? "#ff3333" : timeLeft <= 10 ? "#ff8800" : "#00ff88",
                animation: timeLeft <= 5 && timeLeft > 0 ? "pulse 0.5s infinite" : "none",
              }}>
                {timeLeft}s
              </div>
              {/* Timer bar */}
              <div style={{ width: 80, height: 3, background: "#1a2030", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${timerPct * 100}%`, height: "100%", borderRadius: 2,
                  background: timeLeft <= 5 ? "#ff3333" : timeLeft <= 10 ? "#ff8800" : "#00ff88",
                  transition: "width 1s linear",
                }} />
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1, marginBottom: 2 }}>POT</div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: "#ff8800" }}>
                {roundData ? fmtUsdc(roundData.totalDeposits.toString()) : "0.00"}
              </div>
              <div style={{ fontSize: 9, color: "#3a4a5e" }}>USDC</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1, marginBottom: 2 }}>PLAYERS</div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: "#8a9bae" }}>
                {roundData?.totalPlayers || 0}
              </div>
            </div>
          </div>

          {/* 5x5 Grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4,
            padding: 12, borderRadius: 6, background: "#0d1520", border: "1px solid #1a2535",
          }}>
            {Array.from({ length: 25 }).map((_, i) => {
              const row = Math.floor(i / 5);
              const col = i % 5;
              const count = cellCounts[i];
              const isMyCell = myCell === i;
              const isWinning = lastResult && lastResult.winningCell === i;
              const heat = count / maxCount;
              const isHovered = hoveredCell === i;

              let bg = `rgba(26, 32, 48, ${0.6 + heat * 0.4})`;
              let border = "#1a2535";
              let glow = "none";

              if (count > 0) {
                bg = `rgba(255, 136, 0, ${0.05 + heat * 0.2})`;
                border = `rgba(255, 136, 0, ${0.15 + heat * 0.4})`;
              }
              if (isMyCell) {
                bg = "rgba(0, 180, 255, 0.15)";
                border = "#00b4ff";
                glow = "0 0 8px #00b4ff44";
              }
              if (isWinning) {
                bg = lastResult.isBonus ? "rgba(204, 68, 255, 0.2)" : "rgba(0, 255, 136, 0.15)";
                border = lastResult.isBonus ? "#cc44ff" : "#00ff88";
                glow = undefined; // use animation instead
              }

              const canPick = connected && !hasJoined && !picking && !isExpired;

              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredCell(i)}
                  onMouseLeave={() => setHoveredCell(null)}
                  onClick={() => canPick && handlePickCell(i)}
                  style={{
                    aspectRatio: "1", borderRadius: 4, display: "flex",
                    flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: isHovered && canPick ? "rgba(255, 136, 0, 0.12)" : bg,
                    border: `1px solid ${isHovered && canPick ? "#ff8800" : border}`,
                    boxShadow: glow,
                    cursor: canPick ? "pointer" : "default",
                    transition: "all 0.15s",
                    position: "relative",
                    animation: isWinning ? (lastResult.isBonus ? "bonusGlow 1.5s infinite" : "winGlow 1.5s infinite") : "none",
                  }}
                >
                  <div style={{ fontSize: 9, color: "#3a4a5e", fontWeight: 500 }}>
                    {row},{col}
                  </div>
                  {count > 0 && (
                    <div style={{
                      fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700,
                      color: isMyCell ? "#00b4ff" : "#ff8800",
                    }}>
                      {count}
                    </div>
                  )}
                  {isMyCell && (
                    <div style={{ fontSize: 8, color: "#00b4ff", fontWeight: 600, letterSpacing: 0.5 }}>YOU</div>
                  )}
                  {isWinning && (
                    <div style={{
                      position: "absolute", top: 2, right: 4,
                      fontSize: 10, color: lastResult.isBonus ? "#cc44ff" : "#00ff88",
                    }}>
                      {lastResult.isBonus ? "★" : "✓"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Status line */}
          <div style={{
            marginTop: 8, padding: "6px 12px", borderRadius: 3,
            background: "#0d1520", fontSize: 10, color: "#4a5a6e",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>
              Entry: <b style={{ color: "#8a9bae" }}>{fmtUsdc(entryFee.toString())} USDC</b>
            </span>
            <span>
              {hasJoined
                ? <span style={{ color: "#00b4ff" }}>Entered → cell ({Math.floor(myCell / 5)},{myCell % 5})</span>
                : isExpired
                  ? <span style={{ color: "#ff3333" }}>Round ending...</span>
                  : connected
                    ? <span>Pick a cell to enter</span>
                    : <span>Connect wallet to play</span>
              }
            </span>
            <span>
              Cells occupied: <b style={{ color: "#8a9bae" }}>{cellCounts.filter((c) => c > 0).length}/25</b>
            </span>
          </div>

          {/* ─── TABS: Rounds / History / Leaderboard ─── */}
          <div style={{ display: "flex", gap: 0, marginTop: 16, borderBottom: "1px solid #1a2535" }}>
            {[
              { id: "rounds", label: "ROUND HISTORY" },
              { id: "history", label: "MY PLAYS" },
              { id: "leaderboard", label: "LEADERBOARD" },
            ].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600,
                  padding: "8px 16px", border: "none", borderBottom: tab === t.id ? "2px solid #ff8800" : "2px solid transparent",
                  background: "none", color: tab === t.id ? "#ff8800" : "#3a4a5e",
                  cursor: "pointer", letterSpacing: 1,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ─── ROUND HISTORY TABLE ─── */}
          {tab === "rounds" && (
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
              {recentRounds.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#3a4a5e", fontSize: 11 }}>No rounds yet</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ color: "#3a4a5e", textAlign: "left", borderBottom: "1px solid #1a2535" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>ROUND</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>PLAYERS</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>POT</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WINNER CELL</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WINNERS</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>PROOF</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>TX</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>TIME</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRounds.map((r) => (
                      <tr key={r.round_id} style={{ borderBottom: "1px solid #0d1520" }}>
                        <td style={{ padding: "5px 8px", color: r.is_bonus ? "#cc44ff" : "#8a9bae", fontWeight: 600 }}>
                          #{r.round_id} {r.is_bonus && <span title="Motherlode Round">★</span>}
                        </td>
                        <td style={{ padding: "5px 8px", color: "#6a7b8e" }}>{r.total_players}</td>
                        <td style={{ padding: "5px 8px", color: "#ff8800" }}>{fmtUsdc(r.total_deposits)}</td>
                        <td style={{ padding: "5px 8px", color: r.winning_cell != null ? "#00ff88" : "#3a4a5e" }}>
                          {r.winning_cell != null ? `(${Math.floor(r.winning_cell / 5)},${r.winning_cell % 5})` : "—"}
                        </td>
                        <td style={{ padding: "5px 8px", color: "#6a7b8e" }}>{r.winners_count || 0}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 2,
                            background: r.kurier_status === "verified" ? "#00ff8810" : r.kurier_status === "skipped" ? "#3a4a5e10" : "#ff333310",
                            color: r.kurier_status === "verified" ? "#00ff88" : r.kurier_status === "skipped" ? "#3a4a5e" : "#ff6666",
                            border: `1px solid ${r.kurier_status === "verified" ? "#00ff8833" : r.kurier_status === "skipped" ? "#3a4a5e33" : "#ff333333"}`,
                          }}>
                            {r.kurier_status === "verified" ? "ZK ✓" : r.kurier_status === "skipped" ? "SKIP" : r.kurier_status || "—"}
                          </span>
                          {r.proving_time_ms > 0 && (
                            <span style={{ fontSize: 8, color: "#3a4a5e", marginLeft: 4 }}>{r.proving_time_ms}ms</span>
                          )}
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          {r.resolve_tx_hash ? (
                            <a href={`${BASESCAN}/tx/${r.resolve_tx_hash}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: "#00b4ff", textDecoration: "none", fontSize: 9 }}>
                              {r.resolve_tx_hash.slice(0, 8)}...
                            </a>
                          ) : "—"}
                        </td>
                        <td style={{ padding: "5px 8px", color: "#3a4a5e", fontSize: 9 }}>
                          {timeSince(r.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ─── USER PLAY HISTORY TABLE ─── */}
          {tab === "history" && (
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
              {!connected ? (
                <div style={{ padding: 20, textAlign: "center", color: "#3a4a5e", fontSize: 11 }}>Connect wallet to see history</div>
              ) : userHistory.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#3a4a5e", fontSize: 11 }}>No plays yet</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ color: "#3a4a5e", textAlign: "left", borderBottom: "1px solid #1a2535" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>ROUND</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>MY CELL</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WINNER CELL</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>RESULT</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>POT</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>PICK TX</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>RESOLVE TX</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>CLAIMED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userHistory.map((h, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #0d1520" }}>
                        <td style={{ padding: "5px 8px", color: h.is_bonus ? "#cc44ff" : "#8a9bae", fontWeight: 600 }}>
                          #{h.round_id} {h.is_bonus && "★"}
                        </td>
                        <td style={{ padding: "5px 8px", color: "#00b4ff" }}>
                          ({Math.floor(h.cell_picked / 5)},{h.cell_picked % 5})
                        </td>
                        <td style={{ padding: "5px 8px", color: h.winning_cell != null ? "#00ff88" : "#3a4a5e" }}>
                          {h.winning_cell != null ? `(${Math.floor(h.winning_cell / 5)},${h.winning_cell % 5})` : "—"}
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          {h.is_winner ? (
                            <span style={{ color: "#00ff88", fontWeight: 700 }}>WIN</span>
                          ) : (
                            <span style={{ color: "#ff3333" }}>LOSS</span>
                          )}
                        </td>
                        <td style={{ padding: "5px 8px", color: "#ff8800" }}>
                          {fmtUsdc(h.total_deposits)}
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          {h.pick_tx_hash ? (
                            <a href={`${BASESCAN}/tx/${h.pick_tx_hash}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: "#00b4ff", textDecoration: "none", fontSize: 9 }}>
                              {h.pick_tx_hash.slice(0, 8)}...
                            </a>
                          ) : "—"}
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          {h.resolve_tx_hash ? (
                            <a href={`${BASESCAN}/tx/${h.resolve_tx_hash}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: "#00b4ff", textDecoration: "none", fontSize: 9 }}>
                              {h.resolve_tx_hash.slice(0, 8)}...
                            </a>
                          ) : "—"}
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          {h.is_winner ? (
                            h.claimed ? (
                              <span style={{ color: "#00ff88", fontSize: 9 }}>
                                {h.claim_tx_hash ? (
                                  <a href={`${BASESCAN}/tx/${h.claim_tx_hash}`} target="_blank" rel="noopener noreferrer"
                                    style={{ color: "#00ff88", textDecoration: "none" }}>
                                    CLAIMED ✓
                                  </a>
                                ) : "CLAIMED ✓"}
                              </span>
                            ) : (
                              <button onClick={() => handleClaim(h.round_id)} disabled={claiming !== null}
                                style={{
                                  fontSize: 9, padding: "2px 8px", borderRadius: 2,
                                  background: "#00ff8815", border: "1px solid #00ff8844", color: "#00ff88",
                                  cursor: claiming ? "wait" : "pointer", fontWeight: 600,
                                }}>
                                CLAIM
                              </button>
                            )
                          ) : (
                            <span style={{ color: "#3a4a5e", fontSize: 9 }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ─── LEADERBOARD ─── */}
          {tab === "leaderboard" && (
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
              {leaderboard.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#3a4a5e", fontSize: 11 }}>No players yet</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ color: "#3a4a5e", textAlign: "left", borderBottom: "1px solid #1a2535" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>#</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>PLAYER</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WINS</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>ROUNDS</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WIN RATE</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>DEPOSITED</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>WON</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600 }}>LAST PLAYED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((p, i) => {
                      const isMe = address && p.player_address.toLowerCase() === address.toLowerCase();
                      return (
                        <tr key={i} style={{
                          borderBottom: "1px solid #0d1520",
                          background: isMe ? "#00b4ff08" : "transparent",
                        }}>
                          <td style={{
                            padding: "5px 8px", fontFamily: "'Orbitron', sans-serif", fontWeight: 700,
                            color: i === 0 ? "#ff8800" : i === 1 ? "#c0c8d0" : i === 2 ? "#ff6633" : "#3a4a5e",
                          }}>
                            {i + 1}
                          </td>
                          <td style={{ padding: "5px 8px", color: isMe ? "#00b4ff" : "#8a9bae" }}>
                            <a href={`${BASESCAN}/address/${p.player_address}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: "inherit", textDecoration: "none" }}>
                              {shortAddr(p.player_address)} {isMe && "(you)"}
                            </a>
                          </td>
                          <td style={{ padding: "5px 8px", color: "#00ff88", fontWeight: 600 }}>{p.total_wins}</td>
                          <td style={{ padding: "5px 8px", color: "#6a7b8e" }}>{p.total_rounds}</td>
                          <td style={{ padding: "5px 8px", color: "#ff8800" }}>{p.win_rate}%</td>
                          <td style={{ padding: "5px 8px", color: "#6a7b8e" }}>{fmtUsdc(p.total_deposited)}</td>
                          <td style={{ padding: "5px 8px", color: "#00ff88" }}>{fmtUsdc(p.total_won)}</td>
                          <td style={{ padding: "5px 8px", color: "#3a4a5e", fontSize: 9 }}>{timeSince(p.last_played)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* ─── RIGHT SIDEBAR ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Last Result */}
          {lastResult && (
            <Panel title={lastResult.isBonus ? "MOTHERLODE!" : "LAST RESULT"} accent={lastResult.isBonus ? "#cc44ff" : "#00ff88"}>
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <div style={{ fontSize: 9, color: "#3a4a5e", letterSpacing: 1 }}>ROUND #{lastResult.roundId}</div>
                <div style={{
                  fontFamily: "'Orbitron', sans-serif", fontSize: 28, fontWeight: 900,
                  color: lastResult.isBonus ? "#cc44ff" : "#00ff88", margin: "4px 0",
                }}>
                  ({Math.floor(lastResult.winningCell / 5)},{lastResult.winningCell % 5})
                </div>
                <div style={{ fontSize: 10, color: "#6a7b8e" }}>
                  {lastResult.totalPlayers} players
                </div>
              </div>
            </Panel>
          )}

          {/* How It Works */}
          <Panel title="HOW IT WORKS">
            {[
              ["1.", "Pick a cell on the 5×5 grid (1 USDC entry)"],
              ["2.", "Round ends after 30 seconds"],
              ["3.", "Real Groth16 VRF proof picks winning cell"],
              ["4.", "Winners on that cell split the pot"],
              ["5.", "Winners also earn $ZERO tokens"],
              ["★", "1% chance of MOTHERLODE (10× payout!)"],
            ].map(([n, d], i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 10 }}>
                <span style={{ color: n === "★" ? "#cc44ff" : "#ff8800", fontWeight: 700, minWidth: 14 }}>{n}</span>
                <span style={{ color: "#6a7b8e" }}>{d}</span>
              </div>
            ))}
          </Panel>

          {/* Contracts */}
          <Panel title="CONTRACTS">
            <Row label="GridZeroV3" value={shortAddr(GRIDZERO_V3_ADDR)} href={`${BASESCAN}/address/${GRIDZERO_V3_ADDR}`} />
            <Row label="ZeroToken" value={shortAddr(ZERO_TOKEN_ADDR)} href={`${BASESCAN}/address/${ZERO_TOKEN_ADDR}`} />
            <Row label="USDC" value={shortAddr(USDC_ADDR)} href={`${BASESCAN}/address/${USDC_ADDR}`} />
            <div style={{ borderTop: "1px solid #1a253510", marginTop: 6, paddingTop: 6 }}>
              <Row label="Network" value="Base (8453)" />
              <Row label="VRF" value="Groth16 (snarkjs)" />
              <Row label="Verification" value="Kurier" />
            </div>
          </Panel>

          {/* Activity Feed */}
          <Panel title="ACTIVITY" live>
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              {feed.length === 0 ? (
                <div style={{ fontSize: 10, color: "#3a4a5e", padding: "8px 0" }}>Waiting for events...</div>
              ) : (
                feed.map((f, i) => (
                  <div key={i} style={{
                    fontSize: 10, color: "#6a7b8e", padding: "2px 0",
                    borderBottom: "1px solid #0a0e14",
                    opacity: i === 0 ? 1 : Math.max(0.3, 1 - i * 0.1),
                  }}>
                    <span style={{ color: "#3a4a5e", fontSize: 8, marginRight: 6 }}>
                      {new Date(f.t).toLocaleTimeString()}
                    </span>
                    {f.msg}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UI Primitives
// ═══════════════════════════════════════════════════════════════
function Panel({ title, children, live, accent }) {
  return (
    <div style={{
      background: "#0d1520", border: `1px solid ${accent ? accent + "33" : "#1a2535"}`,
      borderRadius: 4, padding: "10px 12px",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: accent || "#3a4a5e",
        letterSpacing: 1.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
      }}>
        {title}
        {live && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00ff88", animation: "pulse 2s infinite" }} />}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, href, hl }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10 }}>
      <span style={{ color: "#3a4a5e" }}>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          style={{ color: "#00b4ff", textDecoration: "none" }}>{value}</a>
      ) : (
        <span style={{ color: hl ? "#ff8800" : "#6a7b8e" }}>{value}</span>
      )}
    </div>
  );
}
