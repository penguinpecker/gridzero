'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, parseAbi, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { CONTRACTS, GRIDZERO_ABI, ERC20_ABI, CHAIN_ID } from '../lib/contracts';

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const GRID = 5;
const TOTAL_CELLS = 25;
const POLL_INTERVAL = 2000;

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

const abi = parseAbi(GRIDZERO_ABI);
const erc20Abi = parseAbi(ERC20_ABI);

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export default function GridZeroV2() {
  const { login, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();

  // Round state
  const [roundId, setRoundId] = useState(0n);
  const [roundEnd, setRoundEnd] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalDeposits, setTotalDeposits] = useState(0n);
  const [totalPlayers, setTotalPlayers] = useState(0n);
  const [cellCounts, setCellCounts] = useState(new Array(25).fill(0n));

  // Player state
  const [selectedCell, setSelectedCell] = useState(null);
  const [playerPick, setPlayerPick] = useState(null); // cell player picked this round
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [zeroBalance, setZeroBalance] = useState(0n);
  const [allowance, setAllowance] = useState(0n);

  // Resolved rounds
  const [lastResolved, setLastResolved] = useState(null);
  const [claimableRounds, setClaimableRounds] = useState([]);

  // UI state
  const [txPending, setTxPending] = useState(false);
  const [txStatus, setTxStatus] = useState('');
  const [feed, setFeed] = useState([]);
  const timerRef = useRef(null);

  const address = wallets?.[0]?.address;

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  const addFeed = useCallback((msg) => {
    setFeed(p => [{ msg, time: Date.now() }, ...p].slice(0, 20));
  }, []);

  const getWalletClient = useCallback(async () => {
    const wallet = wallets?.[0];
    if (!wallet) throw new Error('No wallet');
    await wallet.switchChain(CHAIN_ID);
    const provider = await wallet.getEthersProvider();
    return provider.getSigner();
  }, [wallets]);

  // ═══════════════════════════════════════════════════════════════
  // Data Fetching
  // ═══════════════════════════════════════════════════════════════

  const fetchRoundData = useCallback(async () => {
    try {
      const [currentRound] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.GRIDZERO_V2,
          abi,
          functionName: 'getCurrentRound',
        }),
      ]);

      const [rid, startTime, endTime, deposits, players] = currentRound;
      setRoundId(rid);
      setRoundEnd(Number(endTime));
      setTotalDeposits(deposits);
      setTotalPlayers(players);

      // Cell counts
      const counts = await publicClient.readContract({
        address: CONTRACTS.GRIDZERO_V2,
        abi,
        functionName: 'getCellCounts',
        args: [rid],
      });
      setCellCounts(counts);

      // Player's pick this round
      if (address) {
        const pick = await publicClient.readContract({
          address: CONTRACTS.GRIDZERO_V2,
          abi,
          functionName: 'playerCell',
          args: [rid, address],
        });
        setPlayerPick(pick > 0 ? pick - 1 : null);
      }

      // Check previous round for results
      if (rid > 1n) {
        const prevRound = await publicClient.readContract({
          address: CONTRACTS.GRIDZERO_V2,
          abi,
          functionName: 'rounds',
          args: [rid - 1n],
        });
        const [, , , , winCell, resolved, , isBonus] = prevRound;
        if (resolved) {
          setLastResolved({
            roundId: rid - 1n,
            winningCell: winCell,
            isBonusRound: isBonus,
          });
        }
      }

      // Check claimable rounds (last 10)
      if (address) {
        const claimable = [];
        const startCheck = rid > 10n ? rid - 10n : 1n;
        for (let i = startCheck; i < rid; i++) {
          try {
            const isWin = await publicClient.readContract({
              address: CONTRACTS.GRIDZERO_V2,
              abi,
              functionName: 'isWinner',
              args: [i, address],
            });
            if (isWin) {
              const claimed = await publicClient.readContract({
                address: CONTRACTS.GRIDZERO_V2,
                abi,
                functionName: 'hasClaimed',
                args: [i, address],
              });
              if (!claimed) claimable.push(i);
            }
          } catch {}
        }
        setClaimableRounds(claimable);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, [address]);

  const fetchBalances = useCallback(async () => {
    if (!address) return;
    try {
      const [usdc, zero, allow] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.USDC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: CONTRACTS.ZERO_TOKEN,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: CONTRACTS.USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, CONTRACTS.GRIDZERO_V2],
        }),
      ]);
      setUsdcBalance(usdc);
      setZeroBalance(zero);
      setAllowance(allow);
    } catch {}
  }, [address]);

  // ═══════════════════════════════════════════════════════════════
  // Timer
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, roundEnd - now);
      setTimeLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [roundEnd]);

  // ═══════════════════════════════════════════════════════════════
  // Polling
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    fetchRoundData();
    fetchBalances();
    const id = setInterval(() => {
      fetchRoundData();
      fetchBalances();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchRoundData, fetchBalances]);

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  const approveUSDC = async () => {
    try {
      setTxPending(true);
      setTxStatus('Approving USDC...');
      const signer = await getWalletClient();
      const { ethers } = await import('ethers');
      const usdc = new ethers.Contract(CONTRACTS.USDC, [
        'function approve(address spender, uint256 amount) returns (bool)',
      ], signer);
      const tx = await usdc.approve(CONTRACTS.GRIDZERO_V2, ethers.MaxUint256);
      setTxStatus('Waiting for confirmation...');
      await tx.wait();
      setTxStatus('');
      addFeed('✓ USDC approved');
      await fetchBalances();
    } catch (err) {
      setTxStatus('');
      addFeed(`✗ Approve failed: ${err.message?.slice(0, 50)}`);
    } finally {
      setTxPending(false);
    }
  };

  const pickCell = async (cell) => {
    if (playerPick !== null || txPending || timeLeft === 0) return;
    try {
      setTxPending(true);
      const row = Math.floor(cell / 5);
      const col = cell % 5;
      setTxStatus(`Picking cell (${row},${col})...`);
      const signer = await getWalletClient();
      const { ethers } = await import('ethers');
      const game = new ethers.Contract(CONTRACTS.GRIDZERO_V2, [
        'function pickCell(uint8 cell)',
      ], signer);
      const tx = await game.pickCell(cell);
      setTxStatus('Waiting for confirmation...');
      await tx.wait();
      setTxStatus('');
      setPlayerPick(cell);
      setSelectedCell(null);
      addFeed(`⛏ Picked cell (${row},${col})`);
      await fetchRoundData();
      await fetchBalances();
    } catch (err) {
      setTxStatus('');
      addFeed(`✗ Pick failed: ${err.message?.slice(0, 50)}`);
    } finally {
      setTxPending(false);
    }
  };

  const claimWinnings = async (claimRoundId) => {
    try {
      setTxPending(true);
      setTxStatus(`Claiming round ${claimRoundId}...`);
      const signer = await getWalletClient();
      const { ethers } = await import('ethers');
      const game = new ethers.Contract(CONTRACTS.GRIDZERO_V2, [
        'function claim(uint256 roundId)',
      ], signer);
      const tx = await game.claim(claimRoundId);
      setTxStatus('Waiting for confirmation...');
      await tx.wait();
      setTxStatus('');
      addFeed(`💰 Claimed round ${claimRoundId}!`);
      setClaimableRounds(p => p.filter(r => r !== claimRoundId));
      await fetchBalances();
    } catch (err) {
      setTxStatus('');
      addFeed(`✗ Claim failed: ${err.message?.slice(0, 50)}`);
    } finally {
      setTxPending(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Derived
  // ═══════════════════════════════════════════════════════════════

  const maxCellCount = Math.max(1, ...cellCounts.map(Number));
  const needsApproval = allowance < parseUnits('1', 6);
  const hasEnoughUSDC = usdcBalance >= parseUnits('1', 6);
  const canPick = authenticated && !txPending && playerPick === null && timeLeft > 0 && hasEnoughUSDC && !needsApproval;
  const timerPct = roundEnd > 0 ? (timeLeft / 30) * 100 : 0;
  const timerColor = timeLeft <= 5 ? '#ff3333' : timeLeft <= 10 ? '#ffaa00' : '#00ff88';

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes winGlow { 0%,100% { box-shadow: 0 0 8px #00ff8855; } 50% { box-shadow: 0 0 24px #00ff88aa, inset 0 0 8px #00ff8833; } }
        @keyframes loseGlow { 0%,100% { box-shadow: 0 0 8px #ff333355; } 50% { box-shadow: 0 0 20px #ff3333aa; } }
        @keyframes slideUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes barShrink { from { width: 100%; } to { width: 0%; } }
        @keyframes bonusPulse { 0%,100% { text-shadow: 0 0 8px #ffaa00; } 50% { text-shadow: 0 0 24px #ffcc00, 0 0 48px #ff880055; } }
      `}</style>

      {/* ── HEADER ── */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logo}>GRID</span>
          <span style={S.logoAccent}>ZERO</span>
          <span style={S.badge}>V2</span>
          <span style={S.chainBadge}>BASE</span>
        </div>
        <div style={S.headerRight}>
          {authenticated ? (
            <div style={S.walletRow}>
              <div style={S.balanceChip}>
                <span style={S.balLabel}>USDC</span>
                <span style={S.balVal}>{formatUnits(usdcBalance, 6)}</span>
              </div>
              <div style={S.balanceChip}>
                <span style={S.balLabel}>$ZERO</span>
                <span style={{ ...S.balVal, color: '#a78bfa' }}>{Number(formatUnits(zeroBalance, 18)).toFixed(2)}</span>
              </div>
              <button onClick={logout} style={S.disconnectBtn}>
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </button>
            </div>
          ) : (
            <button onClick={login} style={S.connectBtn}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN ── */}
      <main style={S.main}>
        {/* Round Info Bar */}
        <div style={S.roundBar}>
          <div style={S.roundInfo}>
            <span style={S.roundLabel}>ROUND</span>
            <span style={S.roundNum}>{roundId.toString()}</span>
          </div>
          <div style={S.timerWrap}>
            <div style={S.timerBarBg}>
              <div style={{ ...S.timerBarFill, width: `${timerPct}%`, background: timerColor }} />
            </div>
            <span style={{ ...S.timerText, color: timerColor }}>
              {timeLeft > 0 ? `${timeLeft}s` : 'RESOLVING...'}
            </span>
          </div>
          <div style={S.potInfo}>
            <span style={S.potLabel}>POT</span>
            <span style={S.potVal}>{formatUnits(totalDeposits, 6)} USDC</span>
            <span style={S.playersCount}>{totalPlayers.toString()} players</span>
          </div>
        </div>

        {/* Grid + Sidebar */}
        <div style={S.gameArea}>
          {/* 5x5 GRID */}
          <div style={S.gridContainer}>
            <div style={S.grid}>
              {Array.from({ length: TOTAL_CELLS }).map((_, i) => {
                const row = Math.floor(i / 5);
                const col = i % 5;
                const count = Number(cellCounts[i] || 0);
                const heat = count / maxCellCount;
                const isSelected = selectedCell === i;
                const isPicked = playerPick === i;
                const isWinning = lastResolved?.winningCell === i && lastResolved?.roundId === roundId - 1n;
                const isLosing = lastResolved && !isWinning && playerPick !== null && lastResolved.roundId === roundId - 1n;

                let cellBg = `rgba(20, 28, 40, ${0.6 + heat * 0.4})`;
                let border = '1px solid rgba(255,255,255,0.06)';
                let anim = '';

                if (heat > 0) {
                  cellBg = `rgba(255, ${Math.floor(136 - heat * 80)}, ${Math.floor(50 - heat * 50)}, ${0.15 + heat * 0.35})`;
                  border = `1px solid rgba(255, 136, 0, ${0.1 + heat * 0.3})`;
                }
                if (isPicked) {
                  border = '2px solid #00ff88';
                  cellBg = 'rgba(0, 255, 136, 0.1)';
                }
                if (isSelected) {
                  border = '2px solid #ffffff';
                  cellBg = 'rgba(255, 255, 255, 0.08)';
                }

                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (!canPick) return;
                      if (selectedCell === i) {
                        pickCell(i);
                      } else {
                        setSelectedCell(i);
                      }
                    }}
                    style={{
                      ...S.cell,
                      background: cellBg,
                      border,
                      cursor: canPick ? 'pointer' : 'default',
                      animation: isPicked ? 'winGlow 2s ease infinite' : '',
                    }}
                  >
                    <span style={S.cellCoord}>{row},{col}</span>
                    {count > 0 && (
                      <span style={S.cellCount}>{count}</span>
                    )}
                    {isPicked && <span style={S.pickedIcon}>⛏</span>}
                  </button>
                );
              })}
            </div>

            {/* Last round result overlay */}
            {lastResolved && (
              <div style={S.resultOverlay}>
                <span style={S.resultLabel}>
                  {lastResolved.isBonusRound ? '🔥 MOTHERLODE!' : 'LAST ROUND'}
                </span>
                <span style={S.resultCell}>
                  Cell ({Math.floor(lastResolved.winningCell / 5)},{lastResolved.winningCell % 5})
                </span>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          <div style={S.sidebar}>
            {/* Action Panel */}
            <div style={S.panel}>
              <div style={S.panelTitle}>PLAY</div>

              {!authenticated && (
                <button onClick={login} style={S.actionBtn}>
                  Connect Wallet to Play
                </button>
              )}

              {authenticated && needsApproval && (
                <button
                  onClick={approveUSDC}
                  disabled={txPending}
                  style={{ ...S.actionBtn, background: '#2563eb' }}
                >
                  {txPending ? 'Approving...' : 'Approve USDC'}
                </button>
              )}

              {authenticated && !needsApproval && !hasEnoughUSDC && (
                <div style={S.warningBox}>
                  Insufficient USDC. Need 1 USDC to play.
                </div>
              )}

              {authenticated && !needsApproval && hasEnoughUSDC && playerPick === null && timeLeft > 0 && (
                <>
                  {selectedCell !== null ? (
                    <div>
                      <div style={S.selectedInfo}>
                        Cell ({Math.floor(selectedCell / 5)},{selectedCell % 5})
                        <span style={S.selectedPlayers}>
                          {Number(cellCounts[selectedCell] || 0)} players
                        </span>
                      </div>
                      <button
                        onClick={() => pickCell(selectedCell)}
                        disabled={txPending}
                        style={S.actionBtn}
                      >
                        {txPending ? 'Picking...' : 'Pick Cell — 1 USDC'}
                      </button>
                    </div>
                  ) : (
                    <div style={S.hintText}>
                      Tap a cell to select, tap again to pick
                    </div>
                  )}
                </>
              )}

              {authenticated && playerPick !== null && (
                <div style={S.pickedInfo}>
                  ⛏ You picked cell ({Math.floor(playerPick / 5)},{playerPick % 5})
                  <br />
                  <span style={S.waitingText}>Waiting for round to resolve...</span>
                </div>
              )}

              {timeLeft === 0 && (
                <div style={{ ...S.hintText, color: '#ffaa00', animation: 'pulse 1s ease infinite' }}>
                  Round resolving...
                </div>
              )}
            </div>

            {/* Claimable */}
            {claimableRounds.length > 0 && (
              <div style={{ ...S.panel, borderColor: '#00ff88' }}>
                <div style={{ ...S.panelTitle, color: '#00ff88' }}>💰 CLAIM WINNINGS</div>
                {claimableRounds.map(r => (
                  <button
                    key={r.toString()}
                    onClick={() => claimWinnings(r)}
                    disabled={txPending}
                    style={{ ...S.actionBtn, background: '#059669', marginBottom: 6 }}
                  >
                    Claim Round {r.toString()}
                  </button>
                ))}
              </div>
            )}

            {/* Cell Heatmap Legend */}
            <div style={S.panel}>
              <div style={S.panelTitle}>HEATMAP</div>
              <div style={S.heatLegend}>
                <span style={S.heatBox0} />
                <span style={S.heatLabel}>0</span>
                <span style={S.heatBox1} />
                <span style={S.heatLabel}>Low</span>
                <span style={S.heatBox2} />
                <span style={S.heatLabel}>Med</span>
                <span style={S.heatBox3} />
                <span style={S.heatLabel}>Hot</span>
              </div>
              <div style={S.strategyHint}>
                Fewer players on your cell = bigger payout if you win
              </div>
            </div>

            {/* Feed */}
            <div style={S.panel}>
              <div style={S.panelTitle}>ACTIVITY</div>
              <div style={S.feedList}>
                {feed.length === 0 && (
                  <div style={S.feedEmpty}>No activity yet</div>
                )}
                {feed.map((f, i) => (
                  <div key={f.time + i} style={S.feedItem}>
                    {f.msg}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* TX Status */}
        {txStatus && (
          <div style={S.txOverlay}>
            <div style={S.txBox}>
              <div style={{ ...S.spinner, animation: 'pulse 0.8s ease infinite' }}>⏳</div>
              <span>{txStatus}</span>
            </div>
          </div>
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer style={S.footer}>
        <span>GridZero V2 — Base Mainnet</span>
        <span style={S.footerLinks}>
          <a href={`https://basescan.org/address/${CONTRACTS.GRIDZERO_V2}`} target="_blank" rel="noreferrer" style={S.footerLink}>Contract</a>
          <a href="https://github.com/penguinpecker/gridzero" target="_blank" rel="noreferrer" style={S.footerLink}>GitHub</a>
        </span>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════

const S = {
  root: {
    minHeight: '100vh',
    background: '#080b10',
    color: '#c0c8d4',
    fontFamily: "'Chakra Petch', sans-serif",
    display: 'flex',
    flexDirection: 'column',
  },

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(10,14,20,0.95)',
    backdropFilter: 'blur(12px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 4 },
  headerRight: { display: 'flex', alignItems: 'center' },
  logo: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 3,
    color: '#ffffff',
  },
  logoAccent: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 3,
    color: '#ff8800',
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    background: '#ff8800',
    color: '#000',
    padding: '2px 6px',
    borderRadius: 3,
    marginLeft: 8,
    letterSpacing: 1,
  },
  chainBadge: {
    fontSize: 10,
    fontWeight: 600,
    background: 'rgba(59, 130, 246, 0.2)',
    color: '#60a5fa',
    padding: '2px 6px',
    borderRadius: 3,
    marginLeft: 6,
    letterSpacing: 1,
    border: '1px solid rgba(59, 130, 246, 0.3)',
  },
  walletRow: { display: 'flex', alignItems: 'center', gap: 8 },
  balanceChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
  },
  balLabel: { color: '#6b7280', fontFamily: "'Share Tech Mono', monospace", fontSize: 10 },
  balVal: { color: '#e0e8f0', fontFamily: "'Share Tech Mono', monospace", fontWeight: 600 },
  connectBtn: {
    background: '#ff8800',
    color: '#000',
    border: 'none',
    padding: '8px 20px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "'Chakra Petch', sans-serif",
    cursor: 'pointer',
    letterSpacing: 1,
  },
  disconnectBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: '#9ca3af',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '4px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "'Share Tech Mono', monospace",
    cursor: 'pointer',
  },

  // Main
  main: {
    flex: 1,
    padding: '16px 20px',
    maxWidth: 960,
    margin: '0 auto',
    width: '100%',
  },

  // Round Bar
  roundBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '10px 16px',
    marginBottom: 16,
    gap: 16,
  },
  roundInfo: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  roundLabel: { fontSize: 9, color: '#6b7280', letterSpacing: 2, fontWeight: 600 },
  roundNum: { fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: "'Share Tech Mono', monospace" },
  timerWrap: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' },
  timerBarBg: {
    width: '100%',
    height: 6,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  timerBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 1s linear, background 0.3s',
  },
  timerText: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: 2,
  },
  potInfo: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  potLabel: { fontSize: 9, color: '#6b7280', letterSpacing: 2, fontWeight: 600 },
  potVal: { fontSize: 16, fontWeight: 700, color: '#00ff88', fontFamily: "'Share Tech Mono', monospace" },
  playersCount: { fontSize: 10, color: '#6b7280' },

  // Game Area
  gameArea: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
  },

  // Grid
  gridContainer: {
    flex: '0 0 auto',
    position: 'relative',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 4,
    width: 340,
  },
  cell: {
    width: 64,
    height: 64,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transition: 'all 0.15s ease',
    fontFamily: "'Share Tech Mono', monospace",
    outline: 'none',
  },
  cellCoord: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    position: 'absolute',
    top: 4,
    left: 6,
  },
  cellCount: {
    fontSize: 18,
    fontWeight: 700,
    color: '#ff8800',
  },
  pickedIcon: {
    fontSize: 22,
  },

  resultOverlay: {
    position: 'absolute',
    bottom: -28,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 12,
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
  },
  resultLabel: { color: '#ffaa00', fontWeight: 600, animation: 'bonusPulse 2s ease infinite' },
  resultCell: { color: '#9ca3af' },

  // Sidebar
  sidebar: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  panel: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '12px 14px',
  },
  panelTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 2,
    color: '#6b7280',
    marginBottom: 8,
  },
  actionBtn: {
    width: '100%',
    background: '#ff8800',
    color: '#000',
    border: 'none',
    padding: '10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "'Chakra Petch', sans-serif",
    cursor: 'pointer',
    letterSpacing: 1,
  },
  selectedInfo: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedPlayers: { fontSize: 11, color: '#6b7280' },
  hintText: {
    fontSize: 12,
    color: '#4b5563',
    textAlign: 'center',
    padding: '8px 0',
  },
  pickedInfo: {
    fontSize: 13,
    color: '#00ff88',
    textAlign: 'center',
    padding: '4px 0',
  },
  waitingText: {
    fontSize: 11,
    color: '#6b7280',
  },
  warningBox: {
    fontSize: 12,
    color: '#fbbf24',
    background: 'rgba(251, 191, 36, 0.08)',
    border: '1px solid rgba(251, 191, 36, 0.2)',
    borderRadius: 6,
    padding: '8px 10px',
    textAlign: 'center',
  },

  // Heatmap legend
  heatLegend: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  heatBox0: {
    width: 16,
    height: 12,
    borderRadius: 2,
    background: 'rgba(20, 28, 40, 0.8)',
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'inline-block',
  },
  heatBox1: {
    width: 16,
    height: 12,
    borderRadius: 2,
    background: 'rgba(255, 120, 50, 0.15)',
    display: 'inline-block',
  },
  heatBox2: {
    width: 16,
    height: 12,
    borderRadius: 2,
    background: 'rgba(255, 100, 20, 0.3)',
    display: 'inline-block',
  },
  heatBox3: {
    width: 16,
    height: 12,
    borderRadius: 2,
    background: 'rgba(255, 60, 0, 0.5)',
    display: 'inline-block',
  },
  heatLabel: { fontSize: 9, color: '#6b7280' },
  strategyHint: {
    fontSize: 10,
    color: '#4b5563',
    marginTop: 6,
    fontStyle: 'italic',
  },

  // Feed
  feedList: {
    maxHeight: 140,
    overflowY: 'auto',
    fontSize: 11,
    fontFamily: "'Share Tech Mono', monospace",
  },
  feedEmpty: { color: '#374151', textAlign: 'center', padding: 8 },
  feedItem: {
    padding: '3px 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    animation: 'slideUp 0.2s ease',
    color: '#9ca3af',
  },

  // TX overlay
  txOverlay: {
    position: 'fixed',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 200,
  },
  txBox: {
    background: 'rgba(10, 14, 20, 0.95)',
    border: '1px solid rgba(255, 136, 0, 0.3)',
    borderRadius: 10,
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
    color: '#ffaa00',
    backdropFilter: 'blur(12px)',
  },
  spinner: { fontSize: 18 },

  // Footer
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    fontSize: 11,
    color: '#374151',
    display: 'flex',
    justifyContent: 'space-between',
  },
  footerLinks: { display: 'flex', gap: 12 },
  footerLink: { color: '#4b5563', textDecoration: 'none' },
};
