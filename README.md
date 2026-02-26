# GridZero V2 — Round-Based Mining Game on Base

## Game Mechanics

### Core Loop
1. **Round starts** — 30-second timer begins (anchored to Base blocks)
2. **Players pick cells** — 5×5 grid (25 cells), costs 1 USDC per entry
3. **Multiple players per cell** — anyone can pick any cell, popular cells split rewards
4. **Round ends** — resolver bot generates VRF proof from Base block hash
5. **Winning cell revealed** — VRF output → `keccak256(vrfOutput) % 25`
6. **Winners split the pot** — all players on winning cell share USDC + earn $ZERO

### Payout Math
```
Pool = totalPlayers × 1 USDC
Protocol Fee = Pool × 10% (configurable)
Resolver Reward = 0.1 USDC (keeps the bot running)
Distributable = Pool - Fee - Resolver Reward

Each winner gets:
  USDC = Distributable / winnersOnCell
  $ZERO = zeroPerRound / winnersOnCell  (default: 1 $ZERO per round)
```

**Example:** 20 players enter, 3 picked the winning cell:
- Pool = 20 USDC
- Fee = 2 USDC → treasury
- Resolver = 0.1 USDC → bot
- Distributable = 17.9 USDC
- Each winner = 5.97 USDC + 0.33 $ZERO

### Strategy Element
- Pick popular cells → higher chance someone shares your cell → lower payout per winner
- Pick lonely cells → if you win, you keep the whole pot
- Risk/reward: cell heatmap shown to players in real-time

### No Winners (Roll-over)
If nobody picked the winning cell, the USDC stays in the contract and effectively rolls into future rounds. No $ZERO is minted for empty wins.

### Motherlode (Bonus Rounds)
- 1 in 100 rounds is a **Motherlode** round (configurable odds)
- Winners get **10× USDC payout** (funded from accumulated treasury)
- Winners get **10 $ZERO** instead of 1 (10× standard)
- Determined by secondary VRF derivation: `keccak256(vrfOutput, "bonus") % 100 == 0`

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│  GridZeroV2  │◀────│  Resolver    │
│  (Vercel)    │     │  (Base)      │     │  (Railway)   │
│              │     │              │     │              │
│  Privy       │     │  USDC entry  │     │  Block       │
│  wallet      │     │  Round mgmt  │     │  listener    │
│  5×5 grid    │     │  VRF resolve │     │  VRF gen     │
│  live counts │     │  $ZERO mint  │     │  (Kurier)    │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                     ┌──────┴──────┐
                     │  ZeroToken  │
                     │  ($ZERO)    │
                     │  ERC20      │
                     └─────────────┘
```

### Components

| Component | Tech | Location |
|-----------|------|----------|
| Game Contract | Solidity | Base mainnet |
| $ZERO Token | ERC20 (mintable) | Base mainnet |
| Resolver Bot | Node.js + viem | Railway |
| Frontend | React + Privy | Vercel |
| VRF Proofs | Groth16 via Kurier | API call from resolver |

### Round Lifecycle (Resolver Bot)

```
[Base Block N]  → Round 42 starts (startTime = block.timestamp)
[Block N+1..N+14] → Players pick cells (30s window)
[Block N+15] → block.timestamp >= endTime
  → Resolver detects round ended
  → Generates VRF proof from block hash
  → Calls resolveRound(vrfOutput, 42)
  → Winning cell determined on-chain
  → Round 43 starts automatically
  → Players can claim() winnings from round 42
```

## Contracts

### GridZeroV2.sol
- `pickCell(uint8 cell)` — enter round, pay 1 USDC
- `claim(uint256 roundId)` — claim winnings from resolved round
- `resolveRound(bytes vrfOutput, uint256 roundId)` — resolver-only
- `getCellCounts(roundId)` — view: how many players per cell
- `getCurrentRound()` — view: round info + time remaining
- `getPotentialPayout(cell)` — view: estimated payout if you pick this cell

### ZeroToken.sol
- Standard ERC20 with minter role
- GridZeroV2 contract is set as minter
- Mints $ZERO to winners on claim()

## Deployment

### 1. Deploy Contracts (Foundry)
See `contracts/DEPLOY.s.sol` for commands.

### 2. Deploy Resolver Bot (Railway)
```bash
cd backend/
railway init
railway link
railway variables set BASE_RPC_WS=wss://...
railway variables set BASE_RPC_HTTP=https://...
railway variables set GRIDZERO_V2_ADDRESS=0x...
railway variables set RESOLVER_PRIVATE_KEY=0x...
railway variables set KURIER_API_URL=https://api.kurier.xyz/v1
railway variables set KURIER_API_KEY=...
railway up
```

### 3. Fund Resolver Bot
- Send some ETH to the resolver wallet for gas
- The bot earns 0.1 USDC per round resolution (self-sustaining)

### 4. Gas Strategy (Future)
- Privy embedded wallets with sponsored transactions
- Or Coinbase Paymaster / Pimlico for ERC-4337
- Base gas is ~$0.001 per tx anyway

## Token: $ZERO

- **Name:** GridZero
- **Symbol:** ZERO
- **Supply:** Inflationary (minted per round to winners)
- **Default emission:** 1 ZERO per round (~2,880/day at 30s rounds)
- **Motherlode rounds:** 10 ZERO (1 in 100 chance)
- **Utility:** TBD (governance, staking, entry fee discounts, etc.)

## Config Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| entryFee | 1 USDC | Cost to enter a round |
| roundDuration | 30s | Time per round |
| protocolFeeBps | 1000 (10%) | Fee on pot |
| resolverReward | 0.1 USDC | Bot incentive |
| zeroPerRound | 1 ZERO | Standard emission |
| motherlodePerRound | 10 ZERO | Bonus emission |
| bonusRoundOdds | 100 | 1 in N chance |
| bonusMultiplier | 10× | USDC multiplier |
