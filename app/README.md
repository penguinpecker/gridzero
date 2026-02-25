# GridZero — Full ZK Integration Architecture

## Flow: What happens when you click MINE

```
USER CLICKS CELL (x, y)
        │
        ▼
┌─────────────────────────────────────────────┐
│  FRONTEND (GridZero.js)                     │
│  • Wallet connected via window.ethereum     │
│  • Reads grid state from Base via multicall │
│  • POST /api/mine { gridX, gridY, player }  │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│  API: /api/mine/route.js (SERVER-SIDE)      │
│                                             │
│  Stage 1: GROTH16 PROOF                     │
│  ├── prover.js → snarkjs.groth16.fullProve  │
│  ├── Circuit: gridzero_vrf.circom           │
│  ├── Input: { secretSeed, gridX, gridY,     │
│  │           difficultyThreshold }          │
│  └── Output: { randomOutput, oreType,       │
│               isRare }                      │
│                                             │
│  Stage 2: LOCAL VERIFY                      │
│  └── snarkjs.groth16.verify(vkey, pub, prf) │
│                                             │
│  Stage 3: ZKVERIFY SUBMIT                   │
│  ├── zkverify-client.js → zkVerifySession   │
│  ├── .verify().groth16().withRegisteredVk()  │
│  ├── Domain #4 (VRF, aggregation=16)        │
│  └── Returns: { txHash, leaf, attId }       │
│                                             │
│  Stage 4: BASE RECORD                       │
│  ├── Owner wallet → recordMining()          │
│  └── GridZero contract on Base mainnet      │
└────────────────────┬────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────┐    ┌────────────────────────┐
│  ZKVERIFY     │    │  BASE CHAIN            │
│  MAINNET      │    │  (8453)                │
│               │    │                        │
│  Domain #4:   │    │  GridZero contract:    │
│  • Groth16    │    │  • recordMining()      │
│  • agg=16     │    │  • MiningResult stored │
│  • queue=8    │    │  • PlayerStats updated │
│               │    │  • Score calculated    │
│  After 16     │    │                        │
│  proofs:      │    │  After aggregation:    │
│  ┌──────────┐ │    │  ┌──────────────────┐  │
│  │ Merkle   │ │    │  │ settleMining()   │  │
│  │ Tree     │─┼────┼─▶│ • Verify Merkle  │  │
│  │ Root     │ │    │  │   inclusion proof│  │
│  └──────────┘ │    │  │ • Mark settled   │  │
│               │    │  │ • Mint OreToken  │  │
│  Attestation  │    │  └──────────────────┘  │
│  relayed to   │    │                        │
│  Base via     │    │  zkVerify Attestation:  │
│  0xCb47..2b69 │    │  0xCb47..2b69 (proxy)  │
└───────────────┘    └────────────────────────┘
```

## File Structure

```
app/
├── src/
│   ├── app/
│   │   ├── page.js              ← Next.js entry
│   │   ├── layout.js            ← Root layout
│   │   └── api/
│   │       ├── mine/route.js    ← POST: proof gen + zkVerify + Base record
│   │       ├── state/route.js   ← GET: read grid from contract (multicall)
│   │       └── settle/route.js  ← POST: settle with attestation proof
│   ├── components/
│   │   └── GridZero.js          ← Main UI (MegaOre V3 aesthetic)
│   └── lib/
│       ├── abi.js               ← Contract ABIs (GridZero + OreToken)
│       ├── chain.js             ← Addresses, constants, publicClient
│       ├── prover.js            ← snarkjs Groth16 proof generation
│       └── zkverify-client.js   ← zkVerifyJS session + submission
├── package.json
├── next.config.js
├── .env.example
└── README.md
```

## What reads from the blockchain

| Data | Source | Method |
|------|--------|--------|
| Grid cells (mined/unmined) | Base contract | `multicall(isMined)` → `getCell` |
| Player stats (score, inventory) | Base contract | `getPlayerStats(address)` |
| Global stats (totalMined, difficulty) | Base contract | `totalMined()`, `difficultyThreshold()` |
| Leaderboard | Base contract | `getTopPlayers()` → `getPlayerScore()` |
| Domain IDs | Base contract | `vrfDomainId()`, etc. |
| Settlement status | Base contract | `isSettled(x, y)` |

## What writes to the blockchain

| Action | Chain | Method | Who Signs |
|--------|-------|--------|-----------|
| Record mining | Base | `recordMining()` | Server (owner key) |
| Settle mining | Base | `settleMining()` | Server (owner key) |
| Submit proof | zkVerify | `groth16.verify` | Server (zkVerify seed) |
| Batch settle | Base | `batchSettleMining()` | Server (owner key) |

## Pipeline stages shown in UI

1. **GROTH16 PROOF** — Circom VRF circuit compiled to R1CS (1,654 constraints), snarkjs generates witness + proof server-side
2. **LOCAL VERIFY** — snarkjs.groth16.verify checks proof validity before submitting
3. **ZKVERIFY SUBMIT** — Proof sent to zkVerify mainnet domain #4 via zkVerifyJS SDK
4. **PROOF AGGREGATION** — Domain #4 aggregates 16 proofs into Merkle tree, emits `NewAggregationReceipt`
5. **BASE ATTESTATION** — Aggregation root relayed to zkVerify attestation contract on Base (0xCb47...2b69)
6. **ON-CHAIN SETTLE** — `settleMining()` called with Merkle inclusion proof, marks cell as settled

## Running

```bash
cd app
cp .env.example .env  # fill in PRIVATE_KEY and ZKVERIFY_SEED_PHRASE
npm install
npm run dev
```

Requires `../circuits/build/` to contain compiled circuit files (wasm, zkey, vkey).
