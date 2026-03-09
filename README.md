<p align="center">
  <img src="https://img.shields.io/badge/Chain-Base_L2-0052FF?style=for-the-badge&logo=coinbase&logoColor=white" />
  <img src="https://img.shields.io/badge/Entry-1_USDC-2775CA?style=for-the-badge" />
  <img src="https://img.shields.io/badge/ZK-Groth16-1652F0?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Status-Live_on_Mainnet-00CC88?style=for-the-badge" />
</p>

<h1 align="center">◇ ◈ G R I D Z E R O ◈ ◇</h1>

<p align="center">
  <code>ZERO KNOWLEDGE · FULL DEGEN</code>
</p>

<p align="center">
  A provably fair 5×5 grid game on <strong>Base</strong>.<br/>
  Pick a cell. Hope the math gods pick the same one.<br/>
  Winner takes the pot. Every <strong>30 seconds</strong>. Forever.
</p>

<p align="center">
  <a href="https://gridzero-one.vercel.app"><strong>▶ Play Now</strong></a> &nbsp;·&nbsp;
  <a href="https://gridzero-miniapp.vercel.app"><strong>◉ Farcaster</strong></a> &nbsp;·&nbsp;
  <a href="https://gridzero-one.vercel.app/how-to-play"><strong>◇ How to Play</strong></a>
</p>

---

## WTF is GridZero?

GridZero is an onchain lottery that runs every **30 seconds** on **Base**.

There's a 5×5 grid. You pick a cell. You pay **1 USDC**. When the round ends, a cryptographically random winning cell is revealed using a ZK-verified VRF (Verifiable Random Function). If you're standing on the winning cell — **you take the pot**.

No house-edge rigging. No backend coin flips. Just pure math, verified by **Groth16 zero-knowledge proofs**, settled on-chain for anyone to audit.

> **This isn't trust-me-bro gambling. This is trust-the-math gambling.**

---

## 🕹️ How to Play

```
         ┌─────┬─────┬─────┬─────┬─────┐
         │  0  │  1  │  2  │  3  │  4  │
         ├─────┼─────┼─────┼─────┼─────┤
         │  5  │  6  │ ×5  │  8  │  9  │
         ├─────┼─────┼─────┼─────┼─────┤
         │ 10  │ 11  │ YOU │ 13  │ 14  │
         ├─────┼─────┼─────┼─────┼─────┤
         │ 15  │ 16  │ 17  │  ✓  │ 19  │
         ├─────┼─────┼─────┼─────┼─────┤
         │ 20  │ 21  │ 22  │ 23  │ 24  │
         └─────┴─────┴─────┴─────┴─────┘
          ×5 = hot cell    YOU = your pick    ✓ = winner
```

### The Loop

| Step | What Happens |
|:----:|:-------------|
| **01** | **◉ Round Opens** — A new 30-second round begins, anchored to Base block timestamps |
| **02** | **◇ Pick Your Cell** — Choose any cell on the 5×5 grid. Costs **1 USDC**. Multiple players can pick the same cell |
| **03** | **◈ Watch the Heatmap** — See where everyone's betting in real-time. Crowded cells split the pot. Empty cells = full payout |
| **04** | **⬡ VRF Reveals Winner** — Resolver bot generates a Groth16 ZK proof → winning cell = `keccak256(vrfOutput) % 25` |
| **05** | **◆ Collect Winnings** — Winners split the USDC pot + earn **$ZERO** tokens. Claim anytime |

### The Strategy

| Move | Play Style | What Happens |
|:-----|:-----------|:-------------|
| 👥 **The Crowd** | Pick popular cells | More likely someone shares your cell — but lower payout if you win |
| 🐺 **The Loner** | Pick empty cells | If it hits, you keep the **entire pot**. High risk, max reward |
| 🧠 **The Analyst** | Read the heatmap | Find the edge between crowded and empty. Play the meta-game |

> **No winner?** If nobody picked the winning cell, USDC stays in the contract. No $ZERO is minted. The pot effectively rolls forward, making future rounds juicier.

---

## 💎 The Motherlode

Once every ~100 rounds, something special happens.

A **Motherlode** round triggers — determined by a secondary VRF derivation:

```
keccak256(vrfOutput, "bonus") % 100 == 0
```

You won't know it's a Motherlode until the round resolves. **Every round could be the one.**

|  | Standard Round | 💎 Motherlode |
|:--|:--------------|:-------------|
| **USDC Payout** | Normal pot split | **10× USDC** (funded from treasury) |
| **$ZERO Earned** | 10 ZERO | **100 ZERO** |
| **Odds** | 99 in 100 | **1 in 100** |

---

## 🪙 $ZERO Token

| Property | Value |
|:---------|:------|
| **Symbol** | $ZERO |
| **Standard** | ERC-20 on Base |
| **Total Supply** | 1,000,000,000 (1B) |
| **Emission** | ~10 ZERO per round to winners |
| **Daily Rate** | ~28,800 ZERO (at 30s rounds) |
| **Motherlode** | 10× emission on bonus rounds |
| **Contract** | [`0xB684...E859`](https://basescan.org/address/0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859) |

### Payout Flow

```
  ┌──────────────────┐
  │   PLAYER POOL    │
  │  N × 1 USDC      │
  └────────┬─────────┘
           │
     ┌─────┼──────────────┐
     ▼     ▼              ▼
  ┌──────┐ ┌───────────┐ ┌────────────────┐
  │ 10%  │ │ 0.1 USDC  │ │   THE REST     │
  │ FEE  │ │ RESOLVER  │ │   = PRIZE POOL │
  │  →   │ │  BOT      │ │   → split among│
  │TREAS.│ │           │ │     winners    │
  └──────┘ └───────────┘ └────────────────┘
```

**Example:** 20 players enter, 3 picked the winning cell:
- Pool = **20 USDC**
- Protocol fee (10%) = 2 USDC → treasury
- Resolver reward = 0.1 USDC → bot
- Prize pool = **17.9 USDC**
- Each winner = **5.97 USDC** + **$ZERO tokens**

---

## 🏗️ Architecture

```
                         ┌──────────────────┐
                         │     PLAYER       │
                         │  Web App or      │
                         │  Farcaster       │
                         └────────┬─────────┘
                                  │ picks cell (1 USDC)
                                  ▼
  ┌──────────────┐      ┌─────────────────┐      ┌──────────────┐
  │              │      │                 │      │              │
  │  KURIER API  │◀─────│  GRIDZERO V2    │─────▶│  $ZERO TOKEN │
  │              │ VRF  │  (Base L2)      │ mint │  ERC-20      │
  │  Groth16     │ proof│                 │ on   │              │
  │  Sub-second  │─────▶│  USDC custody   │ win  └──────────────┘
  │  verification│verify│  Round mgmt     │
  │              │      │  Winner logic   │
  └──────────────┘      └────────┬────────┘
                                 ▲
                                 │ resolveRound()
                        ┌────────┴────────┐
                        │  RESOLVER BOT   │
                        │  Railway/Node   │
                        │  WebSocket      │
                        │  block listener │
                        └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │   ZKVERIFY      │
                        │   Async proof   │
                        │   settlement    │
                        └─────────────────┘
```

### Tech Stack

| Layer | Tech | Details |
|:------|:-----|:--------|
| **Chain** | Base L2 | ~$0.001/tx, Coinbase ecosystem |
| **Entry Currency** | USDC | 6 decimal precision, stable entry fee |
| **ZK Proofs** | Groth16 via Kurier | Sub-second optimistic verification |
| **Proof Settlement** | zkVerify | Substrate-based async audit trail |
| **Frontend** | Next.js + wagmi + viem | Deployed on Vercel |
| **Wallet** | Farcaster SDK / Privy | Embedded + external wallet support |
| **Resolver** | Node.js | Railway, WebSocket block listener |
| **RPC** | Alchemy | Dedicated endpoint for reliability |
| **Backend** | Supabase | Round tracking + player analytics |

### Round Lifecycle

```
Block N         →  Round #42 starts (startTime = block.timestamp)
                   │
Block N+1…N+14  →  Players pick cells (30-second window)
                   │  Heatmap updates in real-time
                   │
Block N+15      →  block.timestamp ≥ endTime
                   │
                   ├─ Resolver detects round ended
                   ├─ Fetches block hash as entropy source
                   ├─ Kurier API generates Groth16 proof (<1 second)
                   ├─ Calls resolveRound(vrfOutput, 42)
                   ├─ Winning cell computed on-chain
                   ├─ Round #43 auto-starts
                   │
                   └─ Winners call claim() → receive USDC + $ZERO
```

### Why ZK?

Most onchain games use Chainlink VRF or commit-reveal schemes. GridZero uses **Groth16 zero-knowledge proofs** verified through the **Kurier API** because:

- **◇ Instant resolution** — Kurier's optimistic verification means rounds resolve in <1s, not 30s+
- **◇ Permanent audit trail** — zkVerify settles proofs asynchronously on a Substrate chain for verifiable history
- **◇ Provably fair** — Anyone can verify the VRF output was correctly derived from the block hash
- **◇ No oracle dependency** — Randomness from Base block hashes + VRF, not a third-party oracle that could be manipulated

---

## 📄 Smart Contracts

### GridZeroV2.sol — [`0xAd38...a26`](https://basescan.org/address/0xAd38008DF25909366d23f4b12dEADBD8cC586a26)

| Function | Description |
|:---------|:------------|
| `pickCell(uint8 cell)` | Enter current round — pay 1 USDC, pick cell 0–24 |
| `claim(uint256 roundId)` | Claim USDC + $ZERO winnings from a resolved round |
| `resolveRound(bytes, uint256)` | Resolver-only: submit VRF output to determine winner |
| `getCellCounts(roundId)` | View: player count per cell (for heatmap) |
| `getCurrentRound()` | View: active round info + time remaining |
| `getPotentialPayout(cell)` | View: estimated payout if this cell wins |

### ZeroToken.sol — [`0xB684...E859`](https://basescan.org/address/0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859)

Standard ERC-20 with minter role. GridZeroV2 is the authorized minter — it mints `$ZERO` to winners on `claim()`.

---

## 🚀 Deployment

### Contracts (Foundry)

See `contracts/DEPLOY.s.sol` for deployment scripts.

### Resolver Bot (Railway)

```bash
cd services/
railway init && railway link

railway variables set BASE_RPC_WS=wss://...
railway variables set BASE_RPC_HTTP=https://...
railway variables set GRIDZERO_V2_ADDRESS=0xAd38008DF25909366d23f4b12dEADBD8cC586a26
railway variables set RESOLVER_PRIVATE_KEY=0x...
railway variables set KURIER_API_URL=https://api.kurier.xyz/v1
railway variables set KURIER_API_KEY=...

railway up
```

Send some ETH to the resolver wallet for gas. The bot earns **0.1 USDC per resolution** — self-sustaining once running.

---

## ⚙️ Configuration

| Parameter | Default | What it does |
|:----------|:--------|:-------------|
| `entryFee` | 1 USDC | Cost to play a round |
| `roundDuration` | 30 seconds | How long each round lasts |
| `protocolFeeBps` | 1000 (10%) | Protocol's cut of the pot |
| `resolverReward` | 0.1 USDC | Incentive for the resolver bot |
| `zeroPerRound` | 10 ZERO | Standard emission per round |
| `motherlodePerRound` | 100 ZERO | Bonus emission on Motherlode rounds |
| `bonusRoundOdds` | 100 | 1-in-N chance of Motherlode |
| `bonusMultiplier` | 10× | USDC multiplier for Motherlode |

---

## 🔗 Links

| | |
|:--|:--|
| 🎮 **Web App** | [gridzero-one.vercel.app](https://gridzero-one.vercel.app) |
| 🟣 **Farcaster Mini App** | [gridzero-miniapp.vercel.app](https://gridzero-miniapp.vercel.app) |
| 📄 **Game Contract** | [`0xAd38...a26`](https://basescan.org/address/0xAd38008DF25909366d23f4b12dEADBD8cC586a26) |
| 🪙 **$ZERO Token** | [`0xB684...E859`](https://basescan.org/address/0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859) |
| 🔐 **ZK Infra** | [Horizon Labs](https://horizenlabs.io) / [Kurier](https://kurier.xyz) / [zkVerify](https://zkverify.io) |
| 🔵 **Chain** | [Base](https://base.org) (Coinbase L2) |

---

<p align="center">
  <strong>◇ ◈ ZERO KNOWLEDGE · FULL DEGEN ◈ ◇</strong><br/>
  <sub>Built with Groth16 proofs, bad decisions, and USDC you probably shouldn't be gambling.</sub>
</p>
