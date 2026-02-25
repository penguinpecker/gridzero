import { createPublicClient, http, fallback, defineChain } from "viem";
import { base } from "viem/chains";

// ═══════════════════════════════════════════════════════════════
// Contract Addresses — Base Mainnet
// ═══════════════════════════════════════════════════════════════
export const GRIDZERO_ADDR = "0x561e4419bC46ABfC2EBddC536308674A5b6d1D8f";
export const ORE_TOKEN_ADDR = "0x5AAA886aEb136F9AaeC967CA988f459639cd8954";
export const ZKVERIFY_ATTESTATION_ADDR = "0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69";

// ═══════════════════════════════════════════════════════════════
// zkVerify Config
// ═══════════════════════════════════════════════════════════════
export const ZKVERIFY_WS = "wss://mainnet-rpc.zkverify.io";
export const ZKVERIFY_DOMAINS = {
  VRF: 4,         // Groth16 VRF mining proofs (aggregation=16)
  LEADERBOARD: 5, // RISC Zero leaderboard proofs (aggregation=4)
  DIFFICULTY: 6,  // EZKL difficulty model proofs (aggregation=2)
};

export const VRF_VKEY_HASH = "0x422e4c8b794e4af83529f337ac5bfb9bf97d4e17637c931cc47d54e31a1469f5";

// ═══════════════════════════════════════════════════════════════
// Grid Config
// ═══════════════════════════════════════════════════════════════
export const GRID_SIZE = 32;
export const VISIBLE_SIZE = 10;
export const SECRET_SEED = "42069"; // VRF secret seed (demo)
export const DIFFICULTY = 128;

// ═══════════════════════════════════════════════════════════════
// Ore Definitions
// ═══════════════════════════════════════════════════════════════
export const ORES = [
  { name: "Stone",   color: "#6a7b8e", glow: "#8a9bae", tier: "Common",    emoji: "◇", score: 1,   tokenId: 0 },
  { name: "Coal",    color: "#4a5a6e", glow: "#6a7b8e", tier: "Common",    emoji: "◆", score: 2,   tokenId: 1 },
  { name: "Iron",    color: "#9aa8b8", glow: "#c0ccd8", tier: "Uncommon",  emoji: "▣", score: 5,   tokenId: 2 },
  { name: "Copper",  color: "#ff6633", glow: "#ff8855", tier: "Uncommon",  emoji: "◈", score: 5,   tokenId: 3 },
  { name: "Silver",  color: "#c0c8d0", glow: "#e0e8f0", tier: "Rare",     emoji: "◎", score: 15,  tokenId: 4 },
  { name: "Gold",    color: "#ff8800", glow: "#ffaa33", tier: "Rare",     emoji: "✦", score: 25,  tokenId: 5 },
  { name: "Diamond", color: "#00b4ff", glow: "#44ccff", tier: "Epic",     emoji: "◆", score: 100, tokenId: 6 },
  { name: "Mythril", color: "#cc44ff", glow: "#dd77ff", tier: "Legendary", emoji: "✧", score: 500, tokenId: 7 },
];

export const TIER_COLOR = {
  Common: "#5a6a7e",
  Uncommon: "#ff6633",
  Rare: "#ff8800",
  Epic: "#00b4ff",
  Legendary: "#cc44ff",
};

// ═══════════════════════════════════════════════════════════════
// Pipeline Stage Definitions
// ═══════════════════════════════════════════════════════════════
export const PIPELINE_STAGES = [
  { id: "generate",  label: "GROTH16 PROOF",    icon: "⚡", desc: "Circom VRF circuit → snarkjs fullProve" },
  { id: "verify",    label: "LOCAL VERIFY",      icon: "◆", desc: "snarkjs groth16.verify(vkey, pub, proof)" },
  { id: "submit",    label: "ZKVERIFY SUBMIT",   icon: "↗", desc: "zkVerifyJS → Domain #4 → Groth16 verifier" },
  { id: "aggregate", label: "PROOF AGGREGATION", icon: "▦", desc: "16 proofs → Merkle tree → AggregationReceipt" },
  { id: "attest",    label: "BASE ATTESTATION",  icon: "◎", desc: "Aggregation root relayed to Base chain" },
  { id: "settle",    label: "ON-CHAIN SETTLE",   icon: "✓", desc: "settleMining() + Merkle inclusion proof" },
];

// ═══════════════════════════════════════════════════════════════
// Public Client — Base Mainnet (we control the RPC, not MetaMask)
// ═══════════════════════════════════════════════════════════════
export const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://mainnet.base.org", { timeout: 30_000, retryCount: 2, retryDelay: 1000 }),
    http("https://base.drpc.org", { timeout: 30_000, retryCount: 2, retryDelay: 2000 }),
  ]),
});
