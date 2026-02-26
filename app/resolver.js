import { createPublicClient, createWalletClient, http, webSocket, parseAbi, formatUnits, toHex, keccak256, encodePacked } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'http';
import * as snarkjs from 'snarkjs';
import { readFileSync } from 'fs';
import path from 'path';
import 'dotenv/config';

// ══════════════════════════════════════════════════════════════
// Config
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  gridZeroAddress: process.env.GRIDZERO_V3_ADDRESS,
  resolverKey: process.env.RESOLVER_PRIVATE_KEY,
  kurierUrl: process.env.KURIER_API_URL || 'https://api.kurier.xyz/api/v1',
  kurierKey: process.env.KURIER_API_KEY,
  vkHash: process.env.VK_HASH || '0xf302087ac0d43bf8cdc0a369b2fcbee495936590e34a8c0d4095cf4314e49dfe',
  vrfSecret: process.env.VRF_SECRET,
  rpcWs: process.env.BASE_RPC_WS,
  rpcHttp: process.env.BASE_RPC_HTTP,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
};

// ══════════════════════════════════════════════════════════════
// Circuit Paths (bundled in repo)
// ══════════════════════════════════════════════════════════════

const CIRCUIT_DIR = path.join(process.cwd(), 'circuits', 'build');
const WASM_PATH = path.join(CIRCUIT_DIR, 'gridzero_vrf_js', 'gridzero_vrf.wasm');
const ZKEY_PATH = path.join(CIRCUIT_DIR, 'gridzero_vrf_final.zkey');
const VKEY_PATH = path.join(CIRCUIT_DIR, 'verification_key.json');

let vkeyCache = null;
function getVkey() {
  if (!vkeyCache) vkeyCache = JSON.parse(readFileSync(VKEY_PATH, 'utf-8'));
  return vkeyCache;
}

// ══════════════════════════════════════════════════════════════
// ABI — V3 uses bytes32 vrfOutput (not bytes)
// ══════════════════════════════════════════════════════════════

const GRIDZERO_ABI = parseAbi([
  'function currentRoundId() view returns (uint256)',
  'function rounds(uint256) view returns (uint64 startTime, uint64 endTime, uint256 totalDeposits, uint256 totalPlayers, uint8 winningCell, bool resolved, bool isBonusRound)',
  'function resolveRound(bytes32 vrfOutput, uint256 roundId)',
  'function skipEmptyRound(uint256 roundId)',
  'function getCellCounts(uint256 roundId) view returns (uint256[25])',
  'function getCellPlayers(uint256 roundId, uint8 cell) view returns (address[])',
  'event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 endTime)',
  'event RoundResolved(uint256 indexed roundId, uint8 winningCell, uint256 winnersCount, bool isBonusRound)',
  'event CellPicked(uint256 indexed roundId, address indexed player, uint8 cell)',
  'event EmptyRoundSkipped(uint256 indexed roundId)',
]);

// ══════════════════════════════════════════════════════════════
// Clients
// ══════════════════════════════════════════════════════════════

const account = privateKeyToAccount(CONFIG.resolverKey);

const publicClient = createPublicClient({
  chain: base,
  transport: webSocket(CONFIG.rpcWs, {
    reconnect: { auto: true, delay: 1000, maxAttempts: 50 },
  }),
});

const httpClient = createPublicClient({
  chain: base,
  transport: http(CONFIG.rpcHttp),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(CONFIG.rpcHttp),
});

// ══════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════

let currentRoundId = 0n;
let resolving = false;
let lastBlockNumber = 0n;

// ══════════════════════════════════════════════════════════════
// REAL Groth16 VRF Proof Generation
// ══════════════════════════════════════════════════════════════

async function generateRealVRFProof(roundId, blockHash) {
  console.log(`[VRF] Generating REAL Groth16 proof for round ${roundId}`);
  const start = Date.now();

  // Derive secret_seed from resolver secret + block hash
  // This is a real VRF: secret_seed is private input, output is unpredictable
  // without the secret, but provably correct with the proof
  const seedString = `${CONFIG.vrfSecret}_${blockHash}_round_${roundId}`;
  // Convert to numeric field element (circom needs numbers)
  const seedHash = keccak256(encodePacked(['string'], [seedString]));
  // Take first 31 bytes to stay within BN128 field (< 2^253)
  const secretSeed = BigInt('0x' + seedHash.slice(2, 64)) >> 8n;

  // Resolver address as field element
  const resolverField = BigInt(account.address);

  // Use roundId for grid coordinates — must stay within 32x32 grid range (0-31)
  const gridX = Number(BigInt(roundId) % 32n);
  const gridY = Number((BigInt(roundId) / 32n) % 32n);

  // Nonce from block hash (last 6 hex digits)
  const nonce = Number(BigInt(blockHash) % 1000000n);

  const circuitInput = {
    secret_seed: secretSeed.toString(),
    player_address: resolverField.toString(),
    grid_x: gridX.toString(),
    grid_y: gridY.toString(),
    nonce: nonce.toString(),
    difficulty_threshold: '128',
  };

  console.log(`[VRF] Circuit input: grid=(${gridX},${gridY}), nonce=${nonce}`);

  // Generate real Groth16 proof via snarkjs
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    WASM_PATH,
    ZKEY_PATH
  );

  const elapsed = Date.now() - start;
  console.log(`[VRF] Proof generated in ${elapsed}ms`);

  // Verify locally before submitting
  const vkey = getVkey();
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);

  if (!verified) {
    throw new Error('Local proof verification FAILED — something is wrong with circuit');
  }
  console.log(`[VRF] Local verification: PASSED ✓`);

  // publicSignals[0] = random_output (the VRF output — this is what determines the winner)
  const randomOutput = publicSignals[0];
  console.log(`[VRF] random_output = ${randomOutput}`);
  console.log(`[VRF] Public signals: [${publicSignals.join(', ')}]`);

  return {
    proof,
    publicSignals,
    randomOutput,
    provingTimeMs: elapsed,
  };
}

// ══════════════════════════════════════════════════════════════
// Kurier Optimistic Verification — REAL proof submission
// ══════════════════════════════════════════════════════════════

async function submitToKurier(proof, publicSignals) {
  console.log(`[KURIER] Submitting real Groth16 proof for optimistic verification...`);

  try {
    const response = await fetch(
      `${CONFIG.kurierUrl}/submit-proof/${CONFIG.kurierKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofType: 'groth16',
          vkRegistered: true,
          proofOptions: { library: 'snarkjs', curve: 'bn128' },
          proofData: {
            proof: proof,
            publicSignals: publicSignals,
            vk: CONFIG.vkHash,
          },
        }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      console.log(`[KURIER] ✓ Optimistic verify: ${JSON.stringify(result)}`);
      return { success: true, ...result };
    } else {
      console.warn(`[KURIER] ✗ ${response.status}: ${JSON.stringify(result)}`);
      return { success: false, status: response.status, error: result };
    }
  } catch (err) {
    console.warn(`[KURIER] ✗ Unreachable: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// Supabase — Save round data with tx hash + proof info
// ══════════════════════════════════════════════════════════════

async function supaFetch(endpoint, method = 'GET', body = null) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) return null;

  const headers = {
    'apikey': CONFIG.supabaseKey,
    'Authorization': `Bearer ${CONFIG.supabaseKey}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['Prefer'] = 'return=representation';

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${endpoint}`, opts);
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[SUPABASE] ${method} ${endpoint} → ${res.status}: ${text}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[SUPABASE] Error: ${err.message}`);
    return null;
  }
}

async function saveRoundToSupabase(roundData) {
  // Save round
  const roundResult = await supaFetch('gz_rounds', 'POST', {
    round_id: roundData.roundId,
    start_time: roundData.startTime,
    end_time: roundData.endTime,
    total_deposits: roundData.totalDeposits,
    total_players: roundData.totalPlayers,
    winning_cell: roundData.winningCell,
    winners_count: roundData.winnersCount,
    is_bonus: roundData.isBonus,
    resolve_tx_hash: roundData.resolveTxHash,
    resolve_block: roundData.resolveBlock,
    vrf_output: roundData.vrfOutput,
    proof_pi_a: roundData.proofPiA || null,
    proof_pi_b: roundData.proofPiB || null,
    proof_pi_c: roundData.proofPiC || null,
    public_signals: roundData.publicSignals || null,
    kurier_status: roundData.kurierStatus,
    kurier_response: roundData.kurierResponse || null,
    proving_time_ms: roundData.provingTimeMs,
  });

  if (roundResult) {
    console.log(`[SUPABASE] ✓ Round ${roundData.roundId} saved`);
  }

  // Save player entries
  if (roundData.players && roundData.players.length > 0) {
    const playerRows = roundData.players.map(p => ({
      round_id: roundData.roundId,
      player_address: p.address.toLowerCase(),
      cell_picked: p.cell,
      is_winner: p.cell === roundData.winningCell,
      pick_tx_hash: p.txHash || null,
    }));

    await supaFetch('gz_round_players', 'POST', playerRows);
    console.log(`[SUPABASE] ✓ ${playerRows.length} players saved for round ${roundData.roundId}`);
  }
}

// ══════════════════════════════════════════════════════════════
// Fetch player data from contract events for this round
// ══════════════════════════════════════════════════════════════

async function getRoundPlayers(roundId, fromBlock, toBlock) {
  try {
    const logs = await httpClient.getLogs({
      address: CONFIG.gridZeroAddress,
      event: {
        type: 'event',
        name: 'CellPicked',
        inputs: [
          { type: 'uint256', name: 'roundId', indexed: true },
          { type: 'address', name: 'player', indexed: true },
          { type: 'uint8', name: 'cell', indexed: false },
        ],
      },
      args: { roundId: BigInt(roundId) },
      fromBlock: fromBlock > 50n ? fromBlock - 50n : 0n,
      toBlock: 'latest',
    });

    return logs.map(log => ({
      address: log.args.player,
      cell: Number(log.args.cell),
      txHash: log.transactionHash,
    }));
  } catch (err) {
    console.warn(`[EVENTS] Failed to fetch CellPicked events: ${err.message}`);

    // Fallback: read cell counts from contract
    const cellCounts = await httpClient.readContract({
      address: CONFIG.gridZeroAddress,
      abi: GRIDZERO_ABI,
      functionName: 'getCellCounts',
      args: [BigInt(roundId)],
    });

    const players = [];
    for (let cell = 0; cell < 25; cell++) {
      if (Number(cellCounts[cell]) > 0) {
        const addresses = await httpClient.readContract({
          address: CONFIG.gridZeroAddress,
          abi: GRIDZERO_ABI,
          functionName: 'getCellPlayers',
          args: [BigInt(roundId), cell],
        });
        for (const addr of addresses) {
          players.push({ address: addr, cell, txHash: null });
        }
      }
    }
    return players;
  }
}

// ══════════════════════════════════════════════════════════════
// Round Resolution — THE REAL DEAL
// ══════════════════════════════════════════════════════════════

async function checkAndResolveRound(blockNumber, blockHash, blockTimestamp) {
  if (resolving) return;

  try {
    const roundId = await httpClient.readContract({
      address: CONFIG.gridZeroAddress,
      abi: GRIDZERO_ABI,
      functionName: 'currentRoundId',
    });

    const round = await httpClient.readContract({
      address: CONFIG.gridZeroAddress,
      abi: GRIDZERO_ABI,
      functionName: 'rounds',
      args: [roundId],
    });

    const [startTime, endTime, totalDeposits, totalPlayers, , resolved] = round;

    if (resolved) return;
    if (BigInt(blockTimestamp) < endTime) {
      const remaining = Number(endTime) - Number(blockTimestamp);
      if (remaining <= 5 && Number(totalPlayers) > 0) {
        console.log(`[ROUND ${roundId}] Ending in ${remaining}s | ${totalPlayers} players | ${formatUnits(totalDeposits, 6)} USDC`);
      }
      return;
    }

    resolving = true;
    currentRoundId = roundId;

    // ─── EMPTY ROUND: skip without VRF ───
    if (Number(totalPlayers) === 0) {
      console.log(`[SKIP] Round ${roundId} — 0 players, skipping`);

      const hash = await walletClient.writeContract({
        address: CONFIG.gridZeroAddress,
        abi: GRIDZERO_ABI,
        functionName: 'skipEmptyRound',
        args: [roundId],
      });

      const receipt = await httpClient.waitForTransactionReceipt({ hash });
      console.log(`[SKIP] ✓ Round ${roundId} skipped | tx: ${hash} | gas: ${receipt.gasUsed}`);

      // Save to Supabase (empty round)
      await saveRoundToSupabase({
        roundId: Number(roundId),
        startTime: new Date(Number(startTime) * 1000).toISOString(),
        endTime: new Date(Number(endTime) * 1000).toISOString(),
        totalDeposits: '0',
        totalPlayers: 0,
        winningCell: null,
        winnersCount: 0,
        isBonus: false,
        resolveTxHash: hash,
        resolveBlock: Number(receipt.blockNumber),
        vrfOutput: null,
        kurierStatus: 'skipped',
        provingTimeMs: 0,
        players: [],
      });

      resolving = false;
      return;
    }

    // ─── REAL RESOLUTION: generate proof + resolve ───
    console.log(`\n══════════════════════════════════════════`);
    console.log(`[RESOLVE] Round ${roundId} ended!`);
    console.log(`[RESOLVE] Players: ${totalPlayers} | Pot: ${formatUnits(totalDeposits, 6)} USDC`);

    // Log cell distribution
    const cellCounts = await httpClient.readContract({
      address: CONFIG.gridZeroAddress,
      abi: GRIDZERO_ABI,
      functionName: 'getCellCounts',
      args: [roundId],
    });

    console.log('[RESOLVE] Cell distribution:');
    for (let row = 0; row < 5; row++) {
      const rowCounts = [];
      for (let col = 0; col < 5; col++) {
        const count = Number(cellCounts[row * 5 + col]);
        rowCounts.push(count > 0 ? `\x1b[32m${String(count).padStart(3)}\x1b[0m` : '  .');
      }
      console.log(`  [${rowCounts.join(' | ')}]`);
    }

    // Step 1: Generate REAL Groth16 VRF proof
    const { proof, publicSignals, randomOutput, provingTimeMs } = await generateRealVRFProof(
      roundId.toString(),
      blockHash
    );

    // Step 2: Submit to Kurier for optimistic ZK verification
    const kurierResult = await submitToKurier(proof, publicSignals);

    // Step 3: Convert randomOutput to bytes32 for on-chain submission
    // randomOutput is a decimal string from the circuit — convert to hex bytes32
    const vrfBytes32 = toHex(BigInt(randomOutput), { size: 32 });
    console.log(`[RESOLVE] VRF bytes32: ${vrfBytes32}`);

    // Preview which cell will win (occupied cells only)
    const occupiedCells = [];
    for (let i = 0; i < 25; i++) {
      if (Number(cellCounts[i]) > 0) occupiedCells.push(i);
    }
    const previewIndex = Number(BigInt(randomOutput) % BigInt(occupiedCells.length));
    const previewWinner = occupiedCells[previewIndex];
    console.log(`[RESOLVE] Occupied cells: [${occupiedCells.join(',')}] (${occupiedCells.length} cells)`);
    console.log(`[RESOLVE] VRF selects index ${previewIndex} → cell ${previewWinner} (r${Math.floor(previewWinner/5)},c${previewWinner%5})`);
    console.log(`[RESOLVE] Winners on that cell: ${cellCounts[previewWinner]}`);

    // Step 4: Submit resolution tx on-chain
    console.log('[RESOLVE] Submitting on-chain resolution...');
    const hash = await walletClient.writeContract({
      address: CONFIG.gridZeroAddress,
      abi: GRIDZERO_ABI,
      functionName: 'resolveRound',
      args: [vrfBytes32, roundId],
    });

    console.log(`[RESOLVE] Tx: ${hash}`);
    const receipt = await httpClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log(`[RESOLVE] ✓ Round ${roundId} resolved in block ${receipt.blockNumber}`);
      console.log(`[RESOLVE] Gas: ${receipt.gasUsed} | Kurier: ${kurierResult.success ? 'verified' : 'failed'}`);
    } else {
      console.error(`[RESOLVE] ✗ Tx reverted!`);
    }

    // Parse isBonusRound from RoundResolved event
    let isBonus = false;
    let actualWinnersCount = Number(cellCounts[previewWinner]);
    try {
      const roundResolvedTopic = keccak256(encodePacked(['string'], ['RoundResolved(uint256,uint8,uint256,bool)']));
      const resolvedLog = receipt.logs.find(l => l.topics[0] === roundResolvedTopic);
      if (resolvedLog && resolvedLog.data) {
        // data contains: winningCell(uint8), winnersCount(uint256), isBonusRound(bool)
        // ABI decode: skip first 32 bytes (winningCell padded), next 32 (winnersCount), next 32 (bool)
        const data = resolvedLog.data.slice(2); // remove 0x
        actualWinnersCount = Number(BigInt('0x' + data.slice(64, 128)));
        isBonus = BigInt('0x' + data.slice(128, 192)) === 1n;
        if (isBonus) console.log(`[RESOLVE] 🔥 MOTHERLODE ROUND!`);
      }
    } catch (e) {
      console.warn(`[RESOLVE] Could not parse event: ${e.message}`);
    }

    // Step 5: Get player data and save everything to Supabase
    const players = await getRoundPlayers(roundId, lastBlockNumber > 100n ? lastBlockNumber - 100n : 0n, blockNumber);

    await saveRoundToSupabase({
      roundId: Number(roundId),
      startTime: new Date(Number(startTime) * 1000).toISOString(),
      endTime: new Date(Number(endTime) * 1000).toISOString(),
      totalDeposits: totalDeposits.toString(),
      totalPlayers: Number(totalPlayers),
      winningCell: previewWinner,
      winnersCount: actualWinnersCount,
      isBonus: isBonus,
      resolveTxHash: hash,
      resolveBlock: Number(receipt.blockNumber),
      vrfOutput: randomOutput,
      proofPiA: proof.pi_a,
      proofPiB: proof.pi_b,
      proofPiC: proof.pi_c,
      publicSignals: publicSignals,
      kurierStatus: kurierResult.success ? 'verified' : 'failed',
      kurierResponse: kurierResult,
      provingTimeMs,
      players,
    });

    console.log(`══════════════════════════════════════════\n`);

  } catch (err) {
    console.error('[RESOLVE] Error:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    resolving = false;
  }
}

// ══════════════════════════════════════════════════════════════
// Block Listener
// ══════════════════════════════════════════════════════════════

async function startBlockListener() {
  console.log('═══════════════════════════════════════════');
  console.log('  GridZero V3 Resolver Bot');
  console.log('  Network: Base');
  console.log(`  Contract: ${CONFIG.gridZeroAddress}`);
  console.log(`  Resolver: ${account.address}`);
  console.log(`  Kurier VK: ${CONFIG.vkHash}`);
  console.log(`  Proof: REAL Groth16 via snarkjs`);
  console.log('═══════════════════════════════════════════\n');

  // Verify circuit files exist
  try {
    readFileSync(WASM_PATH);
    readFileSync(ZKEY_PATH);
    readFileSync(VKEY_PATH);
    console.log('[INIT] ✓ Circuit files loaded (WASM + zkey + vkey)');
  } catch (err) {
    console.error('[INIT] ✗ Missing circuit files! Copy from GridZERO/circuits/build/');
    console.error(`  Expected: ${WASM_PATH}`);
    console.error(`  Expected: ${ZKEY_PATH}`);
    console.error(`  Expected: ${VKEY_PATH}`);
    process.exit(1);
  }

  // Verify critical env vars
  if (!CONFIG.vrfSecret) {
    console.error('[INIT] ✗ VRF_SECRET is required! Without it, VRF output is predictable.');
    process.exit(1);
  }
  if (!CONFIG.gridZeroAddress) {
    console.error('[INIT] ✗ GRIDZERO_V3_ADDRESS is required!');
    process.exit(1);
  }
  if (!CONFIG.resolverKey) {
    console.error('[INIT] ✗ RESOLVER_PRIVATE_KEY is required!');
    process.exit(1);
  }

  const roundId = await httpClient.readContract({
    address: CONFIG.gridZeroAddress,
    abi: GRIDZERO_ABI,
    functionName: 'currentRoundId',
  });
  console.log(`[INIT] Current round: ${roundId}`);
  currentRoundId = roundId;

  // ─── Round-synced resolver: read endTime once, fire at endTime + 1s ───
  async function scheduleNextCheck() {
    try {
      const roundId = await httpClient.readContract({
        address: CONFIG.gridZeroAddress,
        abi: GRIDZERO_ABI,
        functionName: 'currentRoundId',
      });

      const round = await httpClient.readContract({
        address: CONFIG.gridZeroAddress,
        abi: GRIDZERO_ABI,
        functionName: 'rounds',
        args: [roundId],
      });

      const endTime = Number(round[1]); // [1] = endTime
      const nowSec = Math.floor(Date.now() / 1000);
      const delaySec = Math.max(endTime - nowSec + 1, 0); // +1s buffer for block inclusion

      console.log(`[SYNC] Round ${roundId} ends in ${delaySec}s (endTime=${endTime}, now=${nowSec})`);

      setTimeout(async () => {
        try {
          const block = await httpClient.getBlock({ blockTag: 'latest' });
          lastBlockNumber = block.number;
          console.log(`[RESOLVE-CHECK] Round ${roundId} | block #${block.number} | blockTime=${Number(block.timestamp)}`);
          await checkAndResolveRound(block.number, block.hash, block.timestamp);
        } catch (err) {
          console.error('[RESOLVE-CHECK] Error:', err.message?.slice(0, 120));
          // Retry in 2s if block timestamp hasn't caught up
          await new Promise(r => setTimeout(r, 2000));
          try {
            const block = await httpClient.getBlock({ blockTag: 'latest' });
            lastBlockNumber = block.number;
            await checkAndResolveRound(block.number, block.hash, block.timestamp);
          } catch (err2) {
            console.error('[RESOLVE-RETRY] Error:', err2.message?.slice(0, 120));
          }
        }
        // Schedule next round check
        scheduleNextCheck();
      }, delaySec * 1000);

    } catch (err) {
      console.error('[SYNC] Error reading round:', err.message?.slice(0, 120));
      // Retry in 5s on failure
      setTimeout(scheduleNextCheck, 5000);
    }
  }

  await scheduleNextCheck();

  publicClient.watchContractEvent({
    address: CONFIG.gridZeroAddress,
    abi: GRIDZERO_ABI,
    eventName: 'CellPicked',
    onLogs: (logs) => {
      for (const log of logs) {
        const { roundId, player, cell } = log.args;
        console.log(`[PICK] Round ${roundId} | ${player.slice(0, 8)}... → cell (${Math.floor(Number(cell)/5)},${Number(cell)%5})`);
      }
    },
  });

  publicClient.watchContractEvent({
    address: CONFIG.gridZeroAddress,
    abi: GRIDZERO_ABI,
    eventName: 'RoundResolved',
    onLogs: (logs) => {
      for (const log of logs) {
        const { roundId, winningCell, winnersCount, isBonusRound } = log.args;
        console.log(`[RESOLVED] Round ${roundId} → cell (${Math.floor(Number(winningCell)/5)},${Number(winningCell)%5}) | ${winnersCount} winners${isBonusRound ? ' 🔥 MOTHERLODE!' : ''}`);
      }
    },
  });

  console.log('[LIVE] Block listener started. Watching for rounds to resolve...\n');

  process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Stopping resolver...');
    unwatch();
    process.exit(0);
  });
}

// ══════════════════════════════════════════════════════════════
// Health Check
// ══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version: 'v3',
      currentRound: currentRoundId.toString(),
      lastBlock: lastBlockNumber.toString(),
      resolving,
      uptime: process.uptime(),
      proof: 'real_groth16_snarkjs',
      kurier: CONFIG.vkHash,
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[HTTP] Health check on :${PORT}/health`);
  startBlockListener().catch(console.error);
});
