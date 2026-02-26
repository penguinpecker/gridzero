"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, http, fallback, parseUnits, encodeFunctionData } from "viem";
import { base } from "viem/chains";

// ═══════════════════════════════════════════════════════════════
// V4 CONTRACT ABI — GridZero: Round-Based Betting on Base (Auto-Pay)
// GridZeroV4: 0x58497ADCc524ee9a0DA11900af32bFa973fE55d3
// ZeroToken: 0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859
// USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// Chain: Base Mainnet (8453)
// ═══════════════════════════════════════════════════════════════
const GRID_ABI = [
  { name: "currentRoundId", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getCurrentRound", type: "function", stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "totalDeposits", type: "uint256" },
      { name: "totalPlayers", type: "uint256" },
      { name: "timeRemaining", type: "uint256" },
    ] },
  { name: "rounds", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "totalDeposits", type: "uint256" },
      { name: "totalPlayers", type: "uint256" },
      { name: "winningCell", type: "uint8" },
      { name: "resolved", type: "bool" },
      { name: "isBonusRound", type: "bool" },
    ] },
  { name: "playerCell", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint8" }] },
  { name: "pickCell", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "cell", type: "uint8" }], outputs: [] },
  { name: "entryFee", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "roundDuration", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "zeroPerRound", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "hasJoined", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "getCellCounts", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ name: "counts", type: "uint256[25]" }] },
  { name: "getCellPlayers", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "cell", type: "uint8" }],
    outputs: [{ name: "", type: "address[]" }] },
];

const TOKEN_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const USDC_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const GRID_ADDR = "0x58497ADCc524ee9a0DA11900af32bFa973fE55d3";
const TOKEN_ADDR = "0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859";
const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CELL_COST = "1";  // 1 USDC
const CELL_COST_RAW = 1000000n; // 1 USDC in 6 decimals
const ROUND_DURATION = 30;
const GRID_SIZE = 5;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const SUPABASE_URL = "https://dqvwpbggjlcumcmlliuj.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdndwYmdnamxjdW1jbWxsaXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzA2NjIsImV4cCI6MjA4NjIwNjY2Mn0.yrkg3mv62F-DiGA8-cajSSkwnhKBXRbVlr4ye6bdfTc";
const dbHeaders = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
const EXPLORER = "https://basescan.org";

const CELL_LABELS = [];
for (let r = 0; r < GRID_SIZE; r++)
  for (let c = 0; c < GRID_SIZE; c++)
    CELL_LABELS.push(`${String.fromCharCode(65 + r)}${c + 1}`);

// Our own public client — WE control the RPC, not MetaMask
const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://mainnet.base.org", {
      timeout: 30_000,
      retryCount: 2,
      retryDelay: 1000,
    }),
    http("https://base.drpc.org", {
      timeout: 30_000,
      retryCount: 2,
      retryDelay: 2000,
    }),
  ]),
});

const fmt = (v, d = 2) => {
  if (!v) return "0." + "0".repeat(d);
  return (Number(v) / 1e6).toFixed(d);
};
const fmtEth = (v, d = 4) => {
  if (!v) return "0." + "0".repeat(d);
  return (Number(v) / 1e18).toFixed(d);
};

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function TheGrid() {
  const { ready, authenticated, login, logout, user, exportWallet } = usePrivy();
  const { wallets } = useWallets();

  // Contract state
  const [round, setRound] = useState(0);
  const [roundStart, setRoundStart] = useState(0);
  const [roundEnd, setRoundEnd] = useState(0);
  const [potSize, setPotSize] = useState("0");
  const [activePlayers, setActivePlayers] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [winningCell, setWinningCell] = useState(-1);
  const [claimedCells, setClaimedCells] = useState(new Set());
  const [cellCounts, setCellCounts] = useState(new Array(TOTAL_CELLS).fill(0));
  const [playerCell, setPlayerCell] = useState(-1);
  const [gridBalance, setGridBalance] = useState("0");
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcApproved, setUsdcApproved] = useState(false);
  const [approving, setApproving] = useState(false);

  // UI state
  const [smoothTime, setSmoothTime] = useState(0);
  const [selectedCell, setSelectedCell] = useState(null);
  const lastTapRef = useRef({ cell: -1, time: 0 });
  const [hoveredCell, setHoveredCell] = useState(-1);
  const [claiming, setClaiming] = useState(false);
  const [feed, setFeed] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [userHistoryLoading, setUserHistoryLoading] = useState(false);
  const userHistoryLoaded = useRef(false);
  const [scanLine, setScanLine] = useState(0);
  const [error, setError] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [walletDropdown, setWalletDropdown] = useState(false); // dropdown open
  const [walletView, setWalletView] = useState("menu"); // "menu" | "withdraw"
  const walletDropdownRef = useRef(null);
  const [lastResult, setLastResult] = useState(null); // { roundId, cell, players, pot, txHash }
  const [roundHistory, setRoundHistory] = useState([]); // array of ALL loaded past results, newest first
  const [moneyFlow, setMoneyFlow] = useState(false);
  const [gridFlash, setGridFlash] = useState(false);
  const [historyPage, setHistoryPage] = useState(0); // current page (0 = newest)
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFullyLoaded, setHistoryFullyLoaded] = useState(false); // true when scanned back to round 1
  const historyCursor = useRef(0); // next round ID to scan backwards from
  const resolverTxHash = useRef(null);
  const HISTORY_PAGE_SIZE = 10;

  const animFrame = useRef(null);
  const pollRef = useRef(null);
  const lastRoundRef = useRef(0);
  const resolverCalledForRound = useRef(0);
  const resolvedRef = useRef(false);

  // ─── Lock body scroll when mobile sidebar is open ───
  useEffect(() => {
    if (mobileMenu) {
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      return () => {
        document.body.style.overflow = "";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.width = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [mobileMenu]);

  // ─── Close wallet dropdown on click outside ───
  useEffect(() => {
    if (!walletDropdown) return;
    const handler = (e) => {
      if (walletDropdownRef.current && !walletDropdownRef.current.contains(e.target)) {
        setWalletDropdown(false);
        setWalletView("menu");
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [walletDropdown]);

  // Get the embedded wallet address
  const wallet = wallets.find((w) => w.walletClientType === "privy") || wallets[0];
  const address = wallet?.address;

  // ─── Smooth 60fps Timer ───
  useEffect(() => {
    const tick = () => {
      if (roundEnd > 0) {
        const remaining = Math.max(0, roundEnd - Date.now() / 1000);
        setSmoothTime(remaining);
      }
      animFrame.current = requestAnimationFrame(tick);
    };
    animFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame.current);
  }, [roundEnd]);

  // ─── Scan Line ───
  useEffect(() => {
    const iv = setInterval(() => setScanLine((p) => (p + 1) % 100), 40);
    return () => clearInterval(iv);
  }, []);

  // ─── Poll Contract (uses OUR public client, not wallet) ───
  const pollError = useRef(null);
  const pollCount = useRef(0);
  const pollState = useCallback(async () => {
    pollCount.current++;
    try {
      // 1. Get current round (CRITICAL - everything depends on this)
      let roundId;
      try {
        roundId = await publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "currentRoundId",
        });
      } catch (e) {
        pollError.current = "RPC: currentRoundId failed - " + (e.shortMessage || e.message || "unknown");
        console.error("Poll: currentRoundId failed", e);
        return; // Can't continue without round ID
      }
      const rNum = Number(roundId);
      setRound(rNum);
      pollError.current = null; // Clear error on success

      // 2. Get round data — V3 field order: [0]start [1]end [2]totalDeposits [3]totalPlayers [4]winningCell [5]resolved [6]isBonusRound
      try {
        const rd = await publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "rounds", args: [roundId],
        });
        setRoundStart(Number(rd[0]));
        setRoundEnd(Number(rd[1]));
        setPotSize(rd[2].toString());
        setActivePlayers(Number(rd[3]));         // [3] = totalPlayers
        const isResolved = rd[5];                // [5] = resolved (bool)
        setResolved(isResolved);
        resolvedRef.current = isResolved;
        if (isResolved && Number(rd[4]) >= 0) {  // [4] = winningCell (uint8)
          setWinningCell(Number(rd[4]));
        } else if (!isResolved) {
          setWinningCell(-1);
        }
      } catch (e) {
        console.error("Poll: rounds() failed", e);
      }

      // 3. V3: Resolver bot on Railway handles resolution — no frontend trigger needed

      // 4. Player data (only if connected)
      if (address) {
        try {
          // V3: playerCell stores cell+1 (0 = not entered), subtract 1 for actual index
          const joined = await publicClient.readContract({
            address: GRID_ADDR, abi: GRID_ABI, functionName: "hasJoined",
            args: [roundId, address],
          });
          if (joined) {
            const pc = await publicClient.readContract({
              address: GRID_ADDR, abi: GRID_ABI, functionName: "playerCell",
              args: [roundId, address],
            });
            setPlayerCell(Number(pc) - 1); // V3: stored as cell+1
          } else {
            setPlayerCell(-1);
          }
        } catch (e) {
          console.error("Poll: playerCell failed", e);
        }

        try {
          const gridBal = await publicClient.readContract({
            address: TOKEN_ADDR, abi: TOKEN_ABI, functionName: "balanceOf",
            args: [address],
          });
          setGridBalance(gridBal.toString());
        } catch (e) {
          console.error("Poll: balanceOf failed", e);
        }

        try {
          const usdcBal = await publicClient.readContract({
            address: USDC_ADDR, abi: USDC_ABI, functionName: "balanceOf",
            args: [address],
          });
          setEthBalance(usdcBal.toString());
        } catch (e) {
          console.error("Poll: USDC balance failed", e);
        }

        try {
          const allowance = await publicClient.readContract({
            address: USDC_ADDR, abi: USDC_ABI, functionName: "allowance",
            args: [address, GRID_ADDR],
          });
          setUsdcApproved(allowance >= CELL_COST_RAW);
        } catch (e) {
          console.error("Poll: allowance check failed", e);
        }
      }

      // 5. Grid cell player counts (V3: getCellCounts takes roundId)
      try {
        const counts = await publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "getCellCounts",
          args: [roundId],
        });
        const claimed = new Set();
        const countsArr = new Array(TOTAL_CELLS).fill(0);
        for (let i = 0; i < TOTAL_CELLS; i++) {
          const count = Number(counts[i]);
          countsArr[i] = count;
          if (count > 0) claimed.add(i);
        }
        setClaimedCells(claimed);
        setCellCounts(countsArr);
      } catch (e) {
        console.error("Poll: getCellCounts failed", e);
      }
    } catch (e) {
      pollError.current = "Poll error: " + (e.shortMessage || e.message || "unknown");
      console.error("Poll error:", e);
    }
  }, [address, roundEnd]);

  useEffect(() => {
    pollState();
    // Poll every 3s — fast enough for 30s rounds, avoids rate limits
    pollRef.current = setInterval(pollState, 3000);
    return () => { clearInterval(pollRef.current); };
  }, [pollState]);

  // ─── Load round history from Supabase ───
  const historyLoaded = useRef(false);
  const historyLoadingRef = useRef(false);
  const historyFullyLoadedRef = useRef(false);
  const historyOffset = useRef(0);
  const historyTotal = useRef(0);

  const fetchRoundHistory = async (offset, limit = HISTORY_PAGE_SIZE) => {
    if (historyLoadingRef.current) return [];
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/gz_rounds?select=*&order=round_id.desc&limit=${limit}&offset=${offset}`,
        { headers: { ...dbHeaders, Prefer: "count=exact" } }
      );
      const total = parseInt(r.headers.get("content-range")?.split("/")[1] || "0", 10);
      historyTotal.current = total;
      const data = await r.json();
      const results = (data || []).map(r => ({
        roundId: r.round_id,
        cell: r.winning_cell,
        players: r.total_players,
        pot: r.total_deposits,
        resolved: true,
        txHash: r.resolve_tx_hash,
      }));
      historyOffset.current = offset + results.length;
      if (historyOffset.current >= historyTotal.current) {
        historyFullyLoadedRef.current = true;
        setHistoryFullyLoaded(true);
      }
      return results;
    } catch (e) {
      console.error("History fetch error:", e);
      return [];
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (!historyLoaded.current) {
      historyLoaded.current = true;
      fetchRoundHistory(0, HISTORY_PAGE_SIZE).then(results => {
        if (results.length > 0) setRoundHistory(results);
      });
    }
  }, []);

  // Load older pages on demand
  const loadOlderHistory = () => {
    if (historyLoadingRef.current || historyFullyLoadedRef.current) return;
    fetchRoundHistory(historyOffset.current, HISTORY_PAGE_SIZE).then(results => {
      if (results.length > 0) {
        setRoundHistory(prev => {
          const existingIds = new Set(prev.map(r => r.roundId));
          const newOnes = results.filter(r => !existingIds.has(r.roundId));
          return [...prev, ...newOnes];
        });
      }
    });
  };

  // ─── User History from Supabase ───
  const userHistoryOffset = useRef(0);
  const userHistoryTotal = useRef(0);

  const fetchUserHistory = async (offset, limit = 10) => {
    if (!address) return [];
    try {
      const addr = address.toLowerCase();
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/gz_round_players?select=round_id,player_address,cell_picked,is_winner,pick_tx_hash,claimed,claim_tx_hash,gz_rounds!inner(winning_cell,total_players,total_deposits,resolve_tx_hash)&player_address=eq.${addr}&order=round_id.desc&limit=${limit}&offset=${offset}`,
        { headers: { ...dbHeaders, Prefer: "count=exact" } }
      );
      const total = parseInt(r.headers.get("content-range")?.split("/")[1] || "0", 10);
      userHistoryTotal.current = total;
      const data = await r.json();
      return (data || []).map(h => ({
        roundId: h.round_id,
        cell: h.cell_picked,
        won: h.is_winner,
        resolved: true,
        pot: h.gz_rounds?.total_deposits || "0",
        payout: h.is_winner ? "winner" : "0",
        cost: "1000000", // 1 USDC
      }));
    } catch (e) {
      console.error("User history fetch error:", e);
      return [];
    }
  };

  useEffect(() => {
    if (address && !userHistoryLoaded.current) {
      userHistoryLoaded.current = true;
      userHistoryOffset.current = 0;
      setUserHistoryLoading(true);
      fetchUserHistory(0, 10).then(results => {
        setUserHistory(results);
        userHistoryOffset.current = results.length;
        setUserHistoryLoading(false);
      });
    }
  }, [address]);

  // Refresh user history when round changes (new resolved round might include user)
  useEffect(() => {
    if (round > 1 && address && userHistoryLoaded.current) {
      // Re-fetch latest to pick up new entries
      fetchUserHistory(0, 10).then(results => {
        if (results.length > 0) {
          setUserHistory(prev => {
            const merged = [...results];
            const newIds = new Set(results.map(r => r.roundId));
            for (const old of prev) {
              if (!newIds.has(old.roundId)) merged.push(old);
            }
            return merged.sort((a, b) => b.roundId - a.roundId);
          });
          userHistoryOffset.current = Math.max(userHistoryOffset.current, results.length);
        }
      });
    }
  }, [round]);

  // ─── Round Change — fetch previous round data, save to history, reset grid ───
  useEffect(() => {
    if (round > 0 && round !== lastRoundRef.current) {
      const prevRound = lastRoundRef.current;

      // Fetch previous round data from contract (don't rely on stale state)
      if (prevRound > 0) {
        publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "rounds", args: [BigInt(prevRound)],
        }).then(rd => {
          const players = Number(rd[3]);   // [3] = totalPlayers
          const cell = Number(rd[4]);     // [4] = winningCell
          const pot = rd[2].toString();
          const isResolved = rd[5]; // V3: bool
          if (players > 0) {
            const result = {
              roundId: prevRound,
              cell,
              players,
              pot,
              resolved: isResolved,
              txHash: resolverTxHash.current || null,
            };
            setLastResult(result);
            setRoundHistory(prev => {
              if (prev.some(r => r.roundId === prevRound)) return prev;
              return [result, ...prev];
            });
            if (isResolved && players > 0) { // V3: cell 0 is valid
              addFeed(`🎯 Round ${prevRound} winner: Cell ${CELL_LABELS[cell] || cell}`);
              setMoneyFlow(true);
              setTimeout(() => setMoneyFlow(false), 2500);
            } else if (players > 0 && !isResolved) {
              addFeed(`⚠ Round ${prevRound} had ${players} player(s) but wasn't resolved`);
            }
            setHistoryPage(0);
          }
          resolverTxHash.current = null;
        }).catch(e => console.error("Failed to fetch prev round:", e));
      }

      // Flash grid on reset
      setGridFlash(true);
      setTimeout(() => setGridFlash(false), 600);
      addFeed(`◆ Round ${round} started`);
      lastRoundRef.current = round;
      setSelectedCell(null);
      setPlayerCell(-1);
      setClaimedCells(new Set());
      setCellCounts(new Array(TOTAL_CELLS).fill(0));
      setWinningCell(-1);
      setResolved(false);
      resolvedRef.current = false;
    }
  }, [round]);

  // ─── Winner detected — trigger animation + update history entry ───
  useEffect(() => {
    if (resolved && winningCell >= 0 && round > 0) {
      const result = {
        roundId: round,
        cell: winningCell,
        players: activePlayers,
        pot: potSize,
        resolved: true,
        txHash: resolverTxHash.current || null,
      };
      setLastResult(result);
      setMoneyFlow(true);
      setTimeout(() => setMoneyFlow(false), 2500);
      // Upsert: update existing entry or prepend new one
      setRoundHistory(prev => {
        const idx = prev.findIndex(r => r.roundId === round);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = result;
          return updated;
        }
        return [result, ...prev];
      });
      setHistoryPage(0);
    }
  }, [resolved, winningCell]);

  // ─── One-Time USDC Approval ───
  const approveUsdc = async () => {
    if (!wallet || approving) return;
    setApproving(true);
    setError(null);
    try {
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address, chain: base, transport: custom(provider),
      });
      addFeed("Approving USDC (one-time)...");
      const approveData = encodeFunctionData({
        abi: USDC_ABI, functionName: "approve",
        args: [GRID_ADDR, parseUnits("1000000", 6)],
      });
      const approveHash = await walletClient.sendTransaction({
        to: USDC_ADDR, data: approveData, gas: 100000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      setUsdcApproved(true);
      addFeed("USDC approved ✓ — double-tap any cell to play!");
    } catch (e) {
      const msg = e.shortMessage || e.message || "Approval failed";
      setError(msg);
      addFeed(`✗ Approval failed: ${msg.slice(0, 80)}`);
    }
    setApproving(false);
  };

  // ─── Pick Cell (via Privy embedded wallet) — direct pickCell, approval already done ───
  const claimCell = async (cellIndex) => {
    if (!wallet || claiming) return;
    setClaiming(true);
    setError(null);

    try {
      // Switch the embedded wallet to Base
      await wallet.switchChain(8453);

      // Get the EIP-1193 provider from Privy
      const provider = await wallet.getEthereumProvider();

      // Create a viem wallet client from the Privy provider
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      // Encode the pickCell call
      const data = encodeFunctionData({
        abi: GRID_ABI,
        functionName: "pickCell",
        args: [cellIndex],
      });

      // Send tx with explicit gas
      const hash = await walletClient.sendTransaction({
        to: GRID_ADDR,
        data,
        gas: 300000n,
      });

      addFeed(`⛏ Claiming cell ${CELL_LABELS[cellIndex]}...`);
      await publicClient.waitForTransactionReceipt({ hash });
      addFeed(`✓ Cell ${CELL_LABELS[cellIndex]} claimed!`);
      setPlayerCell(cellIndex);
      setSelectedCell(null);
      pollState();
    } catch (e) {
      const msg = e.shortMessage || e.message || "Transaction failed";
      setError(msg);
      addFeed(`✗ Failed: ${msg.slice(0, 80)}`);
    }
    setClaiming(false);
  };

  const addFeed = (msg) => {
    setFeed((prev) => [{ msg, time: Date.now() }, ...prev].slice(0, 20));
  };

  // ─── Copy Wallet Address ───
  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ─── Withdraw USDC ───
  const withdrawETH = async () => {
    if (!wallet || !withdrawAddr || !withdrawAmt || withdrawing) return;
    setWithdrawing(true);
    setError(null);
    try {
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });
      // ERC20 transfer for USDC
      const transferData = encodeFunctionData({
        abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable",
          inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
          outputs: [{ type: "bool" }] }],
        functionName: "transfer",
        args: [withdrawAddr, parseUnits(withdrawAmt, 6)],
      });
      const hash = await walletClient.sendTransaction({
        to: USDC_ADDR,
        data: transferData,
        gas: 100000n,
      });
      addFeed(`↗ Withdrawing ${withdrawAmt} USDC...`);
      await publicClient.waitForTransactionReceipt({ hash });
      addFeed(`✓ Withdrawn ${withdrawAmt} USDC`);
      setWithdrawAddr("");
      setWithdrawAmt("");
      setShowWithdraw(false);
      pollState();
    } catch (e) {
      const msg = e.shortMessage || e.message || "Withdraw failed";
      setError(msg);
      addFeed(`✗ Withdraw failed: ${msg.slice(0, 80)}`);
    }
    setWithdrawing(false);
  };

  // ─── Derived UI State ───
  const actualDuration = (roundEnd > 0 && roundStart > 0) ? (roundEnd - roundStart) : ROUND_DURATION;
  const timerProgress = actualDuration > 0 ? smoothTime / actualDuration : 0;
  const timerColor = smoothTime > 10 ? "#ff8800" : smoothTime > 5 ? "#ffaa00" : "#ff3355";

  const getStatus = () => {
    if (!ready) return "INITIALIZING...";
    if (!authenticated) return "LOGIN TO PLAY";
    if (resolved) return `ROUND ${round} RESOLVED`;
    if (smoothTime <= 0 && round > 0) return `RESOLVING ROUND ${round}...`;
    if (smoothTime <= 0) return "WAITING...";
    return `ROUND ${round} ACTIVE`;
  };

  const getCellState = (idx) => {
    if (resolved && winningCell === idx) return "winner";
    if (playerCell === idx) return "yours";
    if (claimedCells.has(idx)) return "claimed";
    return "empty";
  };

  const canClaim = (idx) => {
    return !resolved && smoothTime > 0 && authenticated && playerCell < 0 && usdcApproved;
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      {/* Scan line */}
      <div style={{
        ...S.scanOverlay,
        background: `linear-gradient(180deg,
          transparent ${scanLine - 2}%,
          rgba(255,136,0,0.12) ${scanLine - 1}%,
          rgba(255,136,0,0.35) ${scanLine}%,
          rgba(255,136,0,0.12) ${scanLine + 1}%,
          transparent ${scanLine + 2}%)`,
      }} />
      <div style={S.crtLines} />

      {/* ─── HEADER ─── */}
      <header style={S.header} className="grid-header">
        <div style={S.hLeft}>
          <span style={S.dot} />
          <span style={S.logo}>THE</span>
          <span style={S.logoSub}>GRID</span>
          <span style={S.badge}>MAINNET</span>
          <a href="/how-to-play" className="grid-header-stat" style={{ ...S.badge, textDecoration: "none", cursor: "pointer", background: "rgba(255,136,0,0.06)", border: "1px solid rgba(255,136,0,0.15)" }}>? HOW TO PLAY</a>
        </div>
        <div style={{ ...S.hRight, gap: 10 }}>
          <span style={S.hStat} className="grid-header-stat">
            RND <b style={{ color: "#e0e8f0" }}>#{round}</b>
          </span>
          {authenticated && (
            <>
              <span style={S.hStat} className="grid-header-stat">
                ● {fmtEth(gridBalance, 2)} <b style={{ color: "#ff6633" }}>ZERO</b>
              </span>
              <span style={S.hStat} className="grid-header-stat">
                ◆ {fmt(ethBalance, 2)} <b style={{ color: "#ff8800" }}>USDC</b>
              </span>
            </>
          )}
          {/* Mobile: show balances inline */}
          {authenticated && (
            <span className="grid-mobile-balances" style={{
              display: "none", alignItems: "center", gap: 8,
              fontSize: 11, letterSpacing: 0.5,
            }}>
              <span style={{ color: "#ff8800" }}>{fmt(ethBalance, 2)} <b>USDC</b></span>
              <span style={{ color: "#4a5a6e" }}>|</span>
              <span style={{ color: "#ff6633" }}>{fmtEth(gridBalance, 2)} <b>ZERO</b></span>
            </span>
          )}
          {!authenticated ? (
            <button style={S.loginBtn} onClick={login}>⚡ LOGIN</button>
          ) : (
            <div ref={walletDropdownRef} style={{ position: "relative" }} className="grid-header-wallet-btn">
              <button style={{
                ...S.loginBtn,
                display: "flex", alignItems: "center", gap: 6,
              }} onClick={() => { setWalletDropdown(!walletDropdown); setWalletView("menu"); }}>
                {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "WALLET"}
                <span style={{ fontSize: 8, opacity: 0.6, transition: "transform 0.2s", transform: walletDropdown ? "rotate(180deg)" : "none" }}>▼</span>
              </button>
              {walletDropdown && walletView === "menu" && (
                <div className="grid-wallet-dropdown" style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  width: 210, background: "#0e1218",
                  border: "1px solid rgba(255,136,0,0.25)", borderRadius: 8,
                  overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 9999, animation: "dropIn 0.15s ease-out",
                }}>
                  <button onClick={() => { copyAddress(); setWalletDropdown(false); }} style={S.dropdownItem}>
                    <span style={S.dropdownIcon}>📋</span> {copied ? "Copied!" : "Copy Address"}
                  </button>
                  <div style={S.dropdownDivider} />
                  <button onClick={() => { exportWallet(); setWalletDropdown(false); }} style={S.dropdownItem}>
                    <span style={S.dropdownIcon}>🔑</span> Export Key
                  </button>
                  <div style={S.dropdownDivider} />
                  <button onClick={() => setWalletView("withdraw")} style={S.dropdownItem}>
                    <span style={S.dropdownIcon}>↗</span> Withdraw
                  </button>
                  <div style={S.dropdownDivider} />
                  <button onClick={() => { logout(); setWalletDropdown(false); }} style={{ ...S.dropdownItem, color: "#ff3355" }}>
                    <span style={S.dropdownIcon}>⏻</span> Logout
                  </button>
                </div>
              )}
              {walletDropdown && walletView === "withdraw" && (
                <div className="grid-wallet-dropdown" style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  width: 300, background: "#0e1218",
                  border: "1px solid rgba(255,136,0,0.25)", borderRadius: 8,
                  overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 9999, animation: "dropIn 0.15s ease-out",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 14px", borderBottom: "1px solid rgba(255,136,0,0.12)",
                    background: "rgba(255,136,0,0.04)",
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#ff8800", letterSpacing: 1.5 }}>↗ WITHDRAW USDC</span>
                    <button onClick={() => setWalletView("menu")} style={{
                      fontSize: 10, color: "#6a7b8e", cursor: "pointer", background: "none",
                      border: "1px solid rgba(255,255,255,0.1)", padding: "4px 10px", borderRadius: 4,
                      fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5,
                    }}>◀ BACK</button>
                  </div>
                  <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "0 2px" }}>
                      <span style={{ color: "#4a5a6e" }}>Available</span>
                      <span style={{ color: "#ff8800", fontWeight: 600, cursor: "pointer" }} onClick={() => setWithdrawAmt(fmt(ethBalance, 6))}>{fmt(ethBalance)} USDC (MAX)</span>
                    </div>
                    <input
                      placeholder="Destination address (0x...)"
                      value={withdrawAddr}
                      onChange={(e) => setWithdrawAddr(e.target.value)}
                      style={S.dropdownInput}
                    />
                    <input
                      placeholder="Amount in USDC"
                      value={withdrawAmt}
                      onChange={(e) => setWithdrawAmt(e.target.value)}
                      style={S.dropdownInput}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button
                        style={{ ...S.claimBtn, flex: 1, fontSize: 11, padding: "10px", opacity: withdrawing ? 0.6 : 1 }}
                        onClick={withdrawETH}
                        disabled={withdrawing}
                      >
                        {withdrawing ? "SENDING..." : "SEND"}
                      </button>
                      <button
                        style={{ ...S.claimBtn, fontSize: 11, padding: "10px 16px", borderColor: "#4a5a6e", color: "#6a7b8e", background: "none" }}
                        onClick={() => { setWalletDropdown(false); setWalletView("menu"); setWithdrawAddr(""); setWithdrawAmt(""); }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <button style={{
            ...S.menuBtn,
            display: "none", alignItems: "center", justifyContent: "center",
            width: 44, height: 44, fontSize: 20,
            border: "1px solid rgba(255,136,0,0.3)",
            background: "rgba(255,136,0,0.06)",
            color: "#ff8800",
            WebkitTapHighlightColor: "transparent",
          }} className="grid-menu-btn" onClick={() => { setMobileMenu(!mobileMenu); setWalletDropdown(false); }}>☰</button>
        </div>
      </header>

      {/* ─── MAIN ─── */}
      <div style={S.main} className="grid-main">

        {/* ─── GRID AREA ─── */}
        <div style={S.gridArea} className="grid-game-area">
          {/* Timer */}
          <div style={S.timerWrap}>
            <div style={S.timerBarBg}>
              <div style={{
                ...S.timerBarFill,
                width: `${timerProgress * 100}%`,
                backgroundColor: timerColor,
                boxShadow: `0 0 20px ${timerColor}66`,
              }} />
            </div>
            <div style={{ minWidth: 70, textAlign: "right" }}>
              <span style={{ ...S.timerNum, color: timerColor }}>
                {Math.floor(smoothTime)}
                <span style={S.timerMs}>.{Math.floor((smoothTime % 1) * 10)}</span>s
              </span>
            </div>
          </div>

          {/* Grid */}
          <div style={S.gridOuter}>
            <div style={S.cornerTL} /><div style={S.cornerTR} />
            <div style={S.cornerBL} /><div style={S.cornerBR} />

            {/* Grid flash on new round */}
            {gridFlash && (
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                borderRadius: 8, zIndex: 15, pointerEvents: "none",
                animation: "gridResetFlash 0.6s ease-out forwards",
              }} />
            )}

            <div style={S.grid}>
              {CELL_LABELS.map((label, idx) => {
                const state = getCellState(idx);
                const isSelected = selectedCell === idx;
                const isWinnerCell = resolved && winningCell === idx;
                return (
                  <button
                    key={idx}
                    style={{
                      ...S.cell,
                      ...(state === "winner" ? S.cellWinner : {}),
                      ...(state === "yours" ? S.cellYours : {}),
                      ...(state === "claimed" ? S.cellClaimed : {}),
                      ...(isSelected ? S.cellSelected : {}),
                      ...(hoveredCell === idx && state === "empty" ? {
                        transform: "translateY(-3px) scale(1.03)",
                        boxShadow: "0 6px 16px rgba(255,136,0,0.15)",
                        borderColor: "rgba(255,136,0,0.35)",
                        background: "rgba(255,136,0,0.06)",
                      } : {}),
                      transition: "all 0.15s ease",
                      animationDelay: isWinnerCell ? "0s" : `${Math.floor(idx / GRID_SIZE) * 0.08}s`,
                    }}
                    onMouseEnter={() => setHoveredCell(idx)}
                    onMouseLeave={() => setHoveredCell(-1)}
                    onClick={() => {
                      if (!canClaim(idx)) return;
                      const now = Date.now();
                      const last = lastTapRef.current;
                      if (last.cell === idx && now - last.time < 400 && !claiming) {
                        // Double-tap/click — claim directly
                        claimCell(idx);
                        lastTapRef.current = { cell: -1, time: 0 };
                      } else {
                        // First tap — select
                        setSelectedCell(idx);
                        lastTapRef.current = { cell: idx, time: now };
                      }
                    }}
                    onDoubleClick={() => { if (canClaim(idx) && !claiming) claimCell(idx); }}
                  >
                    <span style={S.cellLabel}>{label}</span>
                    {state === "winner" && <span style={{ ...S.cellIcon, animation: "winnerPop 0.6s ease-out" }}>🎯</span>}
                    {state === "yours" && <span style={S.cellIcon}>⛏</span>}
                    {state === "claimed" && state !== "yours" && <span style={S.cellIcon}>{cellCounts[idx] > 1 ? `${cellCounts[idx]}×` : "●"}</span>}
                    {state === "empty" && <span style={{ fontSize: 9, opacity: 0.3 }}></span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status */}
          <div style={S.statusBar}>
            <span style={{ fontWeight: 600 }}>{getStatus()}</span>
            <span style={{ color: "#7a8b9e" }}>{activePlayers} PLAYERS</span>
          </div>

          {/* Miner dots */}
          <div style={S.dots}>
            {Array.from({ length: TOTAL_CELLS }).map((_, i) => (
              <div key={i} style={{
                ...S.progressDot,
                backgroundColor: i < activePlayers ? "#ff8800" : "rgba(255,255,255,0.08)",
              }} />
            ))}
          </div>

          {/* Approve USDC — one-time, shows when connected but not approved */}
          {authenticated && !usdcApproved && !approving && (
            <button style={{ ...S.claimBtn, maxWidth: 520, marginTop: 12, background: "linear-gradient(135deg, #ff8800, #ff6600)" }} onClick={approveUsdc}>
              🔓 APPROVE USDC TO PLAY (ONE-TIME)
            </button>
          )}
          {approving && (
            <div style={{ ...S.claimingBar, maxWidth: 520, marginTop: 12 }}><div style={S.claimingDot} />APPROVING USDC...</div>
          )}

          {/* Quick instruction */}
          {authenticated && usdcApproved && playerCell < 0 && !resolved && smoothTime > 0 && (
            <div style={{
              width: "100%", maxWidth: 520, textAlign: "center",
              padding: "8px 12px", marginTop: 6,
              fontSize: 10, letterSpacing: 1.5, color: "#4a5a6e",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              ◆ TAP TO SELECT · DOUBLE-TAP TO CLAIM ◆
            </div>
          )}

          {/* Claim button — below grid */}
          {selectedCell !== null && !claiming && authenticated && usdcApproved && (
            <button style={{ ...S.claimBtn, maxWidth: 520, marginTop: 12 }} onClick={() => claimCell(selectedCell)}>
              ⛏ CLAIM CELL {CELL_LABELS[selectedCell]} — {CELL_COST} USDC
            </button>
          )}
          {claiming && (
            <div style={{ ...S.claimingBar, maxWidth: 520, marginTop: 12 }}><div style={S.claimingDot} />CONFIRMING TX...</div>
          )}

          {/* ─── MOBILE USER HISTORY (hidden on desktop, shown on mobile) ─── */}
          {authenticated && userHistory.length > 0 && (
            <div className="grid-mobile-user-history" style={{
              width: "100%", maxWidth: 520, marginTop: 14,
              borderRadius: 10,
              border: "1px solid rgba(255,136,0,0.2)",
              background: "rgba(255,136,0,0.03)",
              overflow: "hidden",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 16px",
                borderBottom: "1px solid rgba(255,136,0,0.1)",
                background: "rgba(255,136,0,0.04)",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#8a9bae" }}>YOUR HISTORY</span>
                <span style={{ fontSize: 10, color: "#5a6a7e", letterSpacing: 1 }}>
                  {userHistoryLoading ? "SCANNING..." : `${userHistory.length} ROUNDS`}
                </span>
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "40px 60px 32px 1fr",
                padding: "8px 16px 4px", gap: 4,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>RESULT</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>ROUND</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>CELL</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700, textAlign: "right" }}>P&L</span>
              </div>
              <div className="grid-user-history-scroll" style={{ maxHeight: 240, overflowY: "auto" }}>
                {userHistory.map((h, i) => {
                  const isWin = h.won;
                  const displayAmt = isWin
                    ? Number(BigInt(h.payout)) / 1e18
                    : Number(BigInt(h.cost)) / 1e18;
                  return (
                    <div key={h.roundId} style={{
                      display: "grid", gridTemplateColumns: "40px 60px 32px 1fr",
                      padding: "7px 16px", gap: 4,
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1,
                        padding: "2px 0", borderRadius: 3, textAlign: "center",
                        background: isWin ? "rgba(0,204,136,0.12)" : "rgba(255,51,85,0.1)",
                        color: isWin ? "#00cc88" : "#ff3355",
                      }}>
                        {isWin ? "WON" : "LOST"}
                      </span>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: "#d0dce8" }}>#{h.roundId}</span>
                      <span style={{ fontSize: 11, color: "#8a9bae" }}>{CELL_LABELS[h.cell] || "?"}</span>
                      <span style={{
                        fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
                        color: isWin ? "#00cc88" : "#ff3355", textAlign: "right",
                      }}>
                        {isWin ? "+" : "-"}{displayAmt.toFixed(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {userHistory.length > 0 && userHistoryOffset.current < userHistoryTotal.current && (
                <div style={{
                  padding: "8px 16px", textAlign: "center",
                  borderTop: "1px solid rgba(255,136,0,0.1)",
                  background: "rgba(255,136,0,0.02)",
                }}>
                  <button
                    onClick={() => {
                      setUserHistoryLoading(true);
                      fetchUserHistory(userHistoryOffset.current, 10).then(results => {
                        setUserHistory(prev => {
                          const ids = new Set(prev.map(h => h.roundId));
                          return [...prev, ...results.filter(r => !ids.has(r.roundId))];
                        });
                        userHistoryOffset.current += results.length;
                        setUserHistoryLoading(false);
                      });
                    }}
                    style={{
                      width: "100%", padding: "6px 0",
                      background: "none", border: "1px solid rgba(255,136,0,0.15)",
                      borderRadius: 4, color: "#ff8800", fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                      letterSpacing: 1, cursor: "pointer",
                    }}
                  >
                    {userHistoryLoading ? "SCANNING..." : "LOAD MORE"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─── ROUND HISTORY TABLE (paginated) ─── */}
          {(() => {
            const totalPages = Math.ceil(roundHistory.length / HISTORY_PAGE_SIZE) || 1;
            const pageStart = historyPage * HISTORY_PAGE_SIZE;
            const pageRows = roundHistory.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
            const hasOlder = roundHistory.length > 0 && (historyPage < totalPages - 1 || !historyFullyLoaded);
            const hasNewer = historyPage > 0;
            return (
            <div style={{
              width: "100%", maxWidth: 520, marginTop: 14,
              borderRadius: 10,
              border: "1px solid rgba(255,136,0,0.2)",
              background: "rgba(255,136,0,0.03)",
              overflow: "hidden",
              animation: "winnerBannerIn 0.5s ease-out",
            }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 16px",
                borderBottom: "1px solid rgba(255,136,0,0.1)",
                background: "rgba(255,136,0,0.04)",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#8a9bae" }}>ROUND HISTORY</span>
                <span style={{ fontSize: 10, color: "#5a6a7e", letterSpacing: 1 }}>
                  {historyLoading ? "SCANNING..." : `${roundHistory.length} ROUNDS${historyFullyLoaded ? "" : "+"} · PAGE ${historyPage + 1}`}
                </span>
              </div>
              {/* Column headers */}
              <div style={{
                display: "grid", gridTemplateColumns: "60px 55px 55px 75px 1fr",
                padding: "8px 16px 4px", gap: 4,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>ROUND</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>WINNER</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>PLAYERS</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 }}>POT</span>
                <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700, textAlign: "right" }}>TX</span>
              </div>
              {/* Rows */}
              <div>
                {pageRows.length === 0 && (
                  <div style={{ padding: "20px 16px", textAlign: "center", color: "#5a6a7e", fontSize: 11, letterSpacing: 1 }}>
                    {historyLoading ? "⟐ SCANNING ROUNDS..." : "NO ROUNDS WITH PLAYERS FOUND"}
                  </div>
                )}
                {pageRows.map((r, i) => {
                  const globalIdx = pageStart + i;
                  const isLatest = globalIdx === 0 && moneyFlow;
                  return (
                    <div key={r.roundId} style={{
                      display: "grid", gridTemplateColumns: "60px 55px 55px 75px 1fr",
                      padding: "7px 16px", gap: 4,
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      background: isLatest ? "rgba(255,200,0,0.06)" : "transparent",
                      transition: "background 0.5s ease",
                      animation: globalIdx === 0 ? "winnerBannerIn 0.4s ease-out" : "none",
                    }}>
                      <span style={{
                        fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
                        color: isLatest ? "#ffc800" : "#d0dce8",
                      }}>#{r.roundId}</span>
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: r.resolved === false ? "#ff6666" : "#ffc800", letterSpacing: 0.5,
                      }}>
                        {r.resolved === false ? "⏳" : (CELL_LABELS[r.cell] || "?")} {globalIdx === 0 && r.resolved !== false ? "🎯" : ""}
                      </span>
                      <span style={{
                        fontFamily: "'Orbitron', sans-serif", fontSize: 11,
                        color: "#c8d6e5",
                      }}>{r.players}</span>
                      <span style={{
                        fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
                        color: isLatest ? "#ffc800" : "#ff8800",
                        animation: isLatest ? "pulse 1s ease-in-out infinite" : "none",
                      }}>{fmt(r.pot)}</span>
                      <span style={{ textAlign: "right" }}>
                        {r.txHash ? (
                          <a
                            href={`${EXPLORER}/tx/${r.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 10, color: "#ff8800", textDecoration: "none", fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {r.txHash.slice(0, 6)}…{r.txHash.slice(-4)} ↗
                          </a>
                        ) : (
                          <a
                            href={`${EXPLORER}/address/${GRID_ADDR}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 10, color: "#5a6a7e", textDecoration: "none" }}
                          >
                            Explorer ↗
                          </a>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Pagination */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 16px",
                borderTop: "1px solid rgba(255,136,0,0.1)",
                background: "rgba(255,136,0,0.02)",
              }}>
                <button
                  onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                  disabled={!hasNewer}
                  style={{
                    background: hasNewer ? "rgba(255,136,0,0.12)" : "transparent",
                    border: hasNewer ? "1px solid rgba(255,136,0,0.3)" : "1px solid rgba(255,255,255,0.06)",
                    color: hasNewer ? "#ff8800" : "#3a4a5e",
                    padding: "4px 14px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                    letterSpacing: 1.5, cursor: hasNewer ? "pointer" : "default",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >◀ NEWER</button>
                <span style={{ fontSize: 10, color: "#5a6a7e", letterSpacing: 1 }}>
                  {pageStart + 1}–{Math.min(pageStart + HISTORY_PAGE_SIZE, roundHistory.length)} of {roundHistory.length}{historyFullyLoaded ? "" : "+"}
                </span>
                <button
                  onClick={() => {
                    const nextPage = historyPage + 1;
                    const nextStart = nextPage * HISTORY_PAGE_SIZE;
                    // If we need more data, fetch it
                    if (nextStart >= roundHistory.length - HISTORY_PAGE_SIZE && !historyFullyLoaded) {
                      loadOlderHistory();
                    }
                    setHistoryPage(nextPage);
                  }}
                  disabled={!hasOlder || historyLoading}
                  style={{
                    background: hasOlder ? "rgba(255,136,0,0.12)" : "transparent",
                    border: hasOlder ? "1px solid rgba(255,136,0,0.3)" : "1px solid rgba(255,255,255,0.06)",
                    color: hasOlder ? "#ff8800" : "#3a4a5e",
                    padding: "4px 14px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                    letterSpacing: 1.5, cursor: hasOlder ? "pointer" : "default",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >{historyLoading ? "LOADING..." : "OLDER ▶"}</button>
              </div>
            </div>
            );
          })()}
        </div>

        {/* ─── SIDEBAR ─── */}
        <div
          className={`grid-sidebar-backdrop ${mobileMenu ? "open" : ""}`}
          onClick={() => setMobileMenu(false)}
          onTouchMove={(e) => e.preventDefault()}
        />
        <div style={S.sidebar} className={`grid-sidebar ${mobileMenu ? "open" : ""}`}>
          {/* Mobile sticky header */}
          <div className="grid-sidebar-header">
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#ff8800" }}>
              ● THE<span style={{ color: "#e0e8f0" }}>GRID</span>
            </span>
            <button
              onClick={() => setMobileMenu(false)}
              style={{
                background: "rgba(255,136,0,0.1)", border: "1px solid rgba(255,136,0,0.3)",
                color: "#ff8800", fontSize: 13, fontWeight: 700, cursor: "pointer",
                padding: "10px 18px", borderRadius: 6, fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 1, minHeight: 44, minWidth: 44,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              ✕ CLOSE
            </button>
          </div>

          {/* Login prompt */}
          {!authenticated && (
            <div style={S.loginPrompt}>
              <div style={S.loginPromptTitle}>⚡ ENTER THE GRID</div>
              <div style={S.loginPromptText}>Login with email or Google to get an instant wallet and start mining.</div>
              <button style={S.claimBtn} onClick={login}>LOGIN TO PLAY</button>
            </div>
          )}

          {/* Sector Analysis */}
          <Panel title="SECTOR ANALYSIS" live>
            <Row label="POT SIZE" value={`${fmt(potSize)} ETH`} />
            <Row label="ACTIVE PLAYERS" value={activePlayers} />
            <Row label="GRID/ROUND" value="1.0 GRID" />
            <Row label="MOTHERLODE" value="1000 ZERO" />
            <Row label="CELL COST" value={`${CELL_COST} USDC`} />
          </Panel>

          {/* Unit Status */}
          {authenticated && (
            <Panel title="UNIT STATUS">
              <Row label="YOUR CELL" value={playerCell >= 0 ? CELL_LABELS[playerCell] : "—"} hl />
              <Row label="GRID BAL" value={fmt(gridBalance, 2)} />
              <Row label="ETH BAL" value={fmt(ethBalance)} />
              <div style={{ padding: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span style={{ color: "#6a7b8e", letterSpacing: 0.5 }}>WALLET</span>
                  <button onClick={copyAddress} style={{ background: "none", border: "none", color: copied ? "#00cc88" : "#ff8800", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    {copied ? "✓ COPIED" : "📋 COPY"}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "#8a9bae", wordBreak: "break-all", marginTop: 4, padding: "6px 8px", background: "rgba(255,136,0,0.04)", borderRadius: 4, border: "1px solid rgba(255,136,0,0.08)", lineHeight: 1.6 }}>
                  {address || "—"}
                </div>
                <div style={{ fontSize: 9, color: "#4a5a6e", marginTop: 4 }}>Send USDC on Base to this address to fund your wallet</div>
              </div>
            </Panel>
          )}

          {/* Error */}
          {error && (
            <div style={S.errorBox} onClick={() => setError(null)}>⚠ {error.slice(0, 120)}</div>
          )}

          {/* User History */}
          {authenticated && (
            <Panel title="YOUR HISTORY">
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {userHistoryLoading && userHistory.length === 0 && (
                  <div style={{ fontSize: 11, color: "#4a5a6e", padding: "10px 0", fontStyle: "italic" }}>Scanning past rounds...</div>
                )}
                {!userHistoryLoading && userHistory.length === 0 && (
                  <div style={{ fontSize: 11, color: "#4a5a6e", padding: "10px 0", fontStyle: "italic" }}>No rounds played yet</div>
                )}
                {userHistory.map((h, i) => {
                  const isWin = h.won;
                  const displayAmt = isWin
                    ? Number(BigInt(h.payout)) / 1e18
                    : Number(BigInt(h.cost)) / 1e18;
                  return (
                    <div key={h.roundId} style={{
                      display: "grid", gridTemplateColumns: "38px 62px 28px 1fr", alignItems: "center",
                      padding: "6px 0", gap: 6,
                      borderBottom: i < userHistory.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                      fontSize: 11,
                    }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1,
                        padding: "2px 5px", borderRadius: 3, textAlign: "center",
                        background: isWin ? "rgba(0,204,136,0.12)" : "rgba(255,51,85,0.1)",
                        color: isWin ? "#00cc88" : "#ff3355",
                      }}>
                        {isWin ? "WON" : "LOST"}
                      </span>
                      <span style={{ color: "#6a7b8e" }}>R#{h.roundId}</span>
                      <span style={{ color: "#4a5a6e", fontSize: 10 }}>{CELL_LABELS[h.cell] || "?"}</span>
                      <span style={{
                        fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
                        color: isWin ? "#00cc88" : "#ff3355", textAlign: "right",
                      }}>
                        {isWin ? "+" : "-"}{displayAmt.toFixed(5)} ETH
                      </span>
                    </div>
                  );
                })}
                {userHistory.length > 0 && userHistoryOffset.current < userHistoryTotal.current && (
                  <button
                    onClick={() => {
                      setUserHistoryLoading(true);
                      fetchUserHistory(userHistoryOffset.current, 10).then(results => {
                        setUserHistory(prev => {
                          const ids = new Set(prev.map(h => h.roundId));
                          return [...prev, ...results.filter(r => !ids.has(r.roundId))];
                        });
                        userHistoryOffset.current += results.length;
                        setUserHistoryLoading(false);
                      });
                    }}
                    style={{
                      width: "100%", padding: "8px 0", marginTop: 6,
                      background: "none", border: "1px solid rgba(255,136,0,0.15)",
                      borderRadius: 4, color: "#ff8800", fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                      letterSpacing: 1, cursor: "pointer",
                    }}
                  >
                    {userHistoryLoading ? "SCANNING..." : "LOAD MORE"}
                  </button>
                )}
              </div>
            </Panel>
          )}

          {/* Feed */}
          <Panel title="EXTRACTION FEED">
            <div style={S.feedBody}>
              {feed.length === 0 ? (
                <div style={S.feedEmpty}>Waiting for activity...</div>
              ) : (
                feed.map((f, i) => (
                  <div key={f.time + "-" + i} style={{ ...S.feedItem, opacity: 1 - i * 0.06 }}>
                    <span style={S.feedTime}>
                      {new Date(f.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span>{f.msg}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* Debug: show poll errors visibly */}
      {round === 0 && (
        <div style={{
          width: "100%", maxWidth: 900, padding: "10px 16px", margin: "8px auto",
          background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.3)",
          borderRadius: 8, fontSize: 11, color: "#ff6666", fontFamily: "'JetBrains Mono', monospace",
        }}>
          <b>⚠ DEBUG:</b> Round = 0 (not loading). Polls: {pollCount.current}.
          {pollError.current && <span> Error: {pollError.current}</span>}
          {!pollError.current && <span> No error caught — poll may not have run yet. Check console.</span>}
          <br/>RPC: https://mainnet.base.org | Contract: {GRID_ADDR.slice(0,10)}...
        </div>
      )}

      {/* ─── FOOTER ─── */}
      <footer style={S.footer}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={S.greenDot} />
          <span style={S.gridOnline}>GRID ONLINE</span>
        </span>
        <span style={{ fontSize: 11, color: "#4a5a6e", letterSpacing: 1 }}>GRIDZERO.COM ◆ BASE ◆ CHAIN 8453</span>
      </footer>

      {/* ─── CSS ─── */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; padding: 0; background: #0a0c0f; overflow-x: hidden; }
        @keyframes cellAppear { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 8px rgba(255,136,0,0.3), inset 0 0 8px rgba(255,136,0,0.1); }
          50% { box-shadow: 0 0 20px rgba(255,136,0,0.6), inset 0 0 15px rgba(255,136,0,0.2); }
        }
        @keyframes winnerGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(255,200,0,0.4), inset 0 0 10px rgba(255,200,0,0.1); }
          50% { box-shadow: 0 0 30px rgba(255,200,0,0.8), inset 0 0 20px rgba(255,200,0,0.3); }
        }
        @keyframes slideIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes moneyFlowBg {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes coinFlow {
          0% { opacity: 0; transform: translateX(-8px) scale(0.5); }
          40% { opacity: 1; transform: translateX(0) scale(1); }
          100% { opacity: 0; transform: translateX(8px) scale(0.5); }
        }
        @keyframes winnerPop {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes gridResetFlash {
          0% { background: rgba(255,136,0,0.25); }
          100% { background: transparent; }
        }
        @keyframes particleFlow {
          0% { left: -5%; opacity: 0; }
          15% { opacity: 0.8; }
          85% { opacity: 0.8; }
          100% { left: 105%; opacity: 0; }
        }
        @keyframes winnerBannerIn {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes scanGlow {
          0% { text-shadow: 0 0 4px #ff8800; }
          50% { text-shadow: 0 0 12px #ff8800, 0 0 24px #ff880044; }
          100% { text-shadow: 0 0 4px #ff8800; }
        }
        @keyframes dropIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .grid-user-history-scroll::-webkit-scrollbar { width: 4px; }
        .grid-user-history-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        .grid-user-history-scroll::-webkit-scrollbar-thumb { background: rgba(255,136,0,0.25); border-radius: 2px; }
        @media (max-width: 768px) {
          .grid-wallet-dropdown { width: calc(100vw - 32px) !important; max-width: 300px !important; right: -10px !important; }
        }
        @media (max-width: 768px) {
          .grid-main { flex-direction: column !important; }
          .grid-mobile-user-history { display: block !important; }
          .grid-sidebar-backdrop {
            display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.75); z-index: 9998;
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            touch-action: none;
          }
          .grid-sidebar-backdrop.open { display: block !important; }
          .grid-sidebar {
            position: fixed !important; top: 0 !important; right: 0 !important; bottom: 0 !important;
            width: 90vw !important; max-width: 420px !important;
            height: 100% !important; height: 100dvh !important;
            z-index: 9999 !important;
            overflow-y: auto !important; overflow-x: hidden !important;
            -webkit-overflow-scrolling: touch !important;
            background: #0a0e14 !important;
            border-left: 1px solid rgba(255,136,0,0.25) !important;
            padding: 0 16px 16px !important;
            padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
            transform: translateX(100%) !important;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            box-shadow: none !important;
            will-change: transform !important;
            overscroll-behavior: contain !important;
          }
          .grid-sidebar.open {
            transform: translateX(0) !important;
            box-shadow: -8px 0 40px rgba(0,0,0,0.6) !important;
          }
          .grid-sidebar-header {
            position: sticky !important; top: 0 !important; z-index: 10 !important;
            background: #0a0e14 !important;
            padding: 16px 0 12px !important;
            margin: 0 -16px !important; padding-left: 16px !important; padding-right: 16px !important;
            padding-top: calc(16px + env(safe-area-inset-top, 0px)) !important;
            border-bottom: 1px solid rgba(255,136,0,0.15) !important;
            display: flex !important; justify-content: space-between !important; align-items: center !important;
          }
          .grid-game-area {
            padding: 8px 12px !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            max-height: none !important;
            justify-content: flex-start !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
          }
          .grid-header-stat { display: none !important; }
          .grid-mobile-balances { display: flex !important; }
          .grid-header-wallet-btn { font-size: 10px !important; padding: 6px 10px !important; }
          .grid-menu-btn { display: flex !important; }
        }
        @media (min-width: 769px) {
          .grid-menu-btn { display: none !important; }
          .grid-sidebar-backdrop { display: none !important; }
          .grid-sidebar-header { display: none !important; }
          .grid-mobile-user-history { display: none !important; }
        }
      `}</style>
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
  root: {
    fontFamily: "'JetBrains Mono', monospace",
    background: "radial-gradient(ellipse at 30% 20%, #0f1923 0%, #0a0c0f 50%, #080a0d 100%)",
    color: "#c8d6e5", minHeight: "100vh",
    display: "flex", flexDirection: "column",
    position: "relative",
  },
  scanOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none", zIndex: 2, transition: "background 0.04s linear",
  },
  crtLines: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none", zIndex: 1,
    background: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 20px", borderBottom: "1px solid rgba(255,136,0,0.12)",
    background: "rgba(10,12,15,0.95)", zIndex: 10, position: "relative",
    flexWrap: "wrap", gap: 8,
  },
  hLeft: { display: "flex", alignItems: "center", gap: 8 },
  hRight: { display: "flex", alignItems: "center", gap: 16 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#ff6633", boxShadow: "0 0 8px #ff663388" },
  logo: { fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 18, color: "#ff6633", letterSpacing: 2 },
  logoSub: { fontFamily: "'Orbitron', sans-serif", fontWeight: 500, fontSize: 18, color: "#e0e8f0", letterSpacing: 2 },
  badge: { fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(255,136,0,0.12)", color: "#ff8800", letterSpacing: 1.5, fontWeight: 600 },
  hStat: { fontSize: 12, color: "#7a8b9e", letterSpacing: 0.5 },
  loginBtn: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700,
    padding: "8px 16px", borderRadius: 6,
    border: "1px solid #ff8800",
    background: "linear-gradient(135deg, rgba(255,136,0,0.15), rgba(255,136,0,0.05))",
    color: "#ff8800", cursor: "pointer", letterSpacing: 1.5,
  },
  menuBtn: { fontSize: 20, background: "none", border: "1px solid rgba(255,255,255,0.15)", color: "#c8d6e5", borderRadius: 6, padding: "4px 10px", cursor: "pointer" },
  main: { display: "flex", flex: 1, gap: 0, position: "relative", zIndex: 5 },
  gridArea: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "16px 24px", minHeight: 0, overflowY: "auto" },
  timerWrap: { width: "100%", maxWidth: 520, display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  timerBarBg: { flex: 1, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" },
  timerBarFill: { height: "100%", borderRadius: 6 },
  timerNum: { fontFamily: "'Orbitron', sans-serif", fontSize: 20, fontWeight: 700, transition: "color 0.5s ease" },
  timerMs: { fontSize: 14, opacity: 0.7 },
  gridOuter: { position: "relative", width: "100%", maxWidth: 520, padding: 12 },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 20, height: 20, borderLeft: "2px solid rgba(255,136,0,0.4)", borderTop: "2px solid rgba(255,136,0,0.4)" },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 20, height: 20, borderRight: "2px solid rgba(255,136,0,0.4)", borderTop: "2px solid rgba(255,136,0,0.4)" },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 20, height: 20, borderLeft: "2px solid rgba(255,136,0,0.4)", borderBottom: "2px solid rgba(255,136,0,0.4)" },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderRight: "2px solid rgba(255,136,0,0.4)", borderBottom: "2px solid rgba(255,136,0,0.4)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, width: "100%" },
  cell: {
    fontFamily: "'JetBrains Mono', monospace", position: "relative",
    aspectRatio: "1", minHeight: 64,
    border: "1px solid rgba(255,136,0,0.08)", borderRadius: 6,
    background: "rgba(255,136,0,0.02)", color: "#5a7a6e",
    cursor: "pointer", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 2,
    fontSize: 11, fontWeight: 600, transition: "all 0.15s ease",
    animation: "cellAppear 0.4s ease both",
    touchAction: "manipulation",
  },
  cellClaimed: { background: "rgba(255,102,51,0.08)", borderColor: "rgba(255,102,51,0.3)", color: "#ff6633", cursor: "default" },
  cellYours: { background: "rgba(255,136,0,0.1)", borderColor: "rgba(255,136,0,0.5)", color: "#ff8800", animation: "glow 2s ease-in-out infinite" },
  cellWinner: { background: "rgba(255,200,0,0.15)", borderColor: "rgba(255,200,0,0.6)", color: "#ffc800", boxShadow: "0 0 20px rgba(255,200,0,0.4), inset 0 0 12px rgba(255,200,0,0.15)", animation: "winnerGlow 1.5s ease-in-out infinite" },
  cellSelected: { background: "rgba(0,180,255,0.12)", borderColor: "rgba(0,180,255,0.5)", color: "#00b4ff", boxShadow: "0 0 15px rgba(0,180,255,0.3)" },
  cellLabel: { letterSpacing: 1 },
  cellIcon: { fontSize: 16 },
  statusBar: { display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 520, padding: "8px 12px", marginTop: 8, fontSize: 11, letterSpacing: 1.5, color: "#5a6a7e" },
  dots: { display: "flex", gap: 3, width: "100%", maxWidth: 520, padding: "0 12px" },
  progressDot: { flex: 1, height: 3, borderRadius: 2, transition: "background-color 0.5s ease" },
  sidebar: {
    width: 340, minWidth: 300, borderLeft: "1px solid rgba(255,136,0,0.08)",
    background: "rgba(10,14,20,0.98)", padding: 16,
    display: "flex", flexDirection: "column", gap: 12,
    overflowY: "auto", maxHeight: "calc(100vh - 100px)",
  },
  closeBtn: { alignSelf: "flex-end", background: "none", border: "none", color: "#7a8b9e", fontSize: 18, cursor: "pointer", padding: "4px 8px" },
  loginPrompt: { border: "1px solid rgba(255,136,0,0.2)", borderRadius: 8, background: "rgba(255,136,0,0.04)", padding: 16, textAlign: "center" },
  loginPromptTitle: { fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 700, color: "#ff8800", marginBottom: 8 },
  loginPromptText: { fontSize: 12, color: "#7a8b9e", marginBottom: 12, lineHeight: 1.5 },
  panel: { border: "1px solid rgba(255,136,0,0.1)", borderRadius: 8, background: "rgba(255,136,0,0.02)", overflow: "hidden" },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#8a9bae", borderBottom: "1px solid rgba(255,136,0,0.06)" },
  liveTag: { color: "#ff8800", fontSize: 10, letterSpacing: 1, animation: "scanGlow 2s ease-in-out infinite" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12 },
  rowLabel: { color: "#6a7b8e", letterSpacing: 0.5 },
  rowValue: { fontWeight: 600, color: "#d0dce8", fontFamily: "'Orbitron', sans-serif", fontSize: 13 },
  claimBtn: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700,
    padding: "14px 20px", borderRadius: 8,
    border: "1px solid #ff8800",
    background: "linear-gradient(135deg, rgba(255,136,0,0.15), rgba(255,136,0,0.05))",
    color: "#ff8800", cursor: "pointer", letterSpacing: 1,
    transition: "all 0.2s", textAlign: "center", width: "100%",
  },
  claimingBar: { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 8, border: "1px solid rgba(255,170,0,0.3)", background: "rgba(255,170,0,0.08)", color: "#ffaa00", fontSize: 12, fontWeight: 600, letterSpacing: 1 },
  claimingDot: { width: 8, height: 8, borderRadius: "50%", background: "#ffaa00", animation: "pulse 1s ease-in-out infinite" },
  errorBox: { padding: "10px 14px", borderRadius: 6, border: "1px solid rgba(255,51,85,0.3)", background: "rgba(255,51,85,0.08)", color: "#ff3355", fontSize: 11, cursor: "pointer" },
  feedBody: { maxHeight: 200, overflowY: "auto" },
  feedEmpty: { color: "#3a4a5e", fontSize: 12, fontStyle: "italic", padding: "12px 0" },
  feedItem: { fontSize: 11, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", gap: 8, animation: "slideIn 0.3s ease" },
  feedTime: { color: "#3a4a5e", fontSize: 10, flexShrink: 0 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderTop: "1px solid rgba(255,136,0,0.08)", background: "rgba(10,12,15,0.95)", zIndex: 10, position: "relative" },
  greenDot: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ff8800", boxShadow: "0 0 6px #ff880088" },
  gridOnline: { fontSize: 12, fontWeight: 700, color: "#ff8800", letterSpacing: 1.5, animation: "scanGlow 3s ease-in-out infinite" },
  dropdownItem: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px", fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11, color: "#c8d6e5", cursor: "pointer",
    border: "none", background: "none", width: "100%",
    textAlign: "left", letterSpacing: 0.5,
    WebkitTapHighlightColor: "transparent",
  },
  dropdownIcon: { fontSize: 14, width: 20, textAlign: "center" },
  dropdownDivider: { height: 1, background: "rgba(255,255,255,0.06)" },
  dropdownInput: {
    width: "100%", padding: "10px 12px", fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,136,0,0.15)",
    borderRadius: 6, color: "#c8d6e5", outline: "none", letterSpacing: 0.3,
  },
};
