import { createPublicClient, http, fallback } from "viem";
import { base } from "viem/chains";

// ═══════════════════════════════════════════════════════════════
// Contract Addresses — Base Mainnet (V3)
// ═══════════════════════════════════════════════════════════════
export const GRIDZERO_V3_ADDR = "0xa106dD7567e5d4368C325f4aB1022a8f1786a59f";
export const ZERO_TOKEN_ADDR = "0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859";
export const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ═══════════════════════════════════════════════════════════════
// Supabase — Public reads via anon key (RLS allows SELECT for all)
// ═══════════════════════════════════════════════════════════════
export const SUPABASE_URL = "https://dqvwpbggjlcumcmlliuj.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdndwYmdnamxjdW1jbWxsaXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzA2NjIsImV4cCI6MjA4NjIwNjY2Mn0.yrkg3mv62F-DiGA8-cajSSkwnhKBXRbVlr4ye6bdfTc";

// ═══════════════════════════════════════════════════════════════
// V3 ABI — Round-based betting game
// ═══════════════════════════════════════════════════════════════
export const GRIDZERO_V3_ABI = [
  { name: "currentRoundId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "rounds", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "startTime", type: "uint64" }, { name: "endTime", type: "uint64" },
      { name: "totalDeposits", type: "uint256" }, { name: "totalPlayers", type: "uint256" },
      { name: "winningCell", type: "uint8" }, { name: "resolved", type: "bool" },
      { name: "isBonusRound", type: "bool" },
    ],
  },
  { name: "getCurrentRound", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint256" }, { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" }, { name: "totalDeposits", type: "uint256" },
      { name: "totalPlayers", type: "uint256" }, { name: "timeRemaining", type: "uint256" },
    ],
  },
  { name: "getCellCounts", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }], outputs: [{ name: "counts", type: "uint256[25]" }],
  },
  { name: "getCellPlayers", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "cell", type: "uint8" }], outputs: [{ type: "address[]" }],
  },
  { name: "isWinner", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }], outputs: [{ type: "bool" }],
  },
  { name: "hasJoined", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }], outputs: [{ type: "bool" }],
  },
  { name: "hasClaimed", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }], outputs: [{ type: "bool" }],
  },
  { name: "playerCell", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }], outputs: [{ type: "uint8" }],
  },
  { name: "entryFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getPotentialPayout", type: "function", stateMutability: "view",
    inputs: [{ name: "cell", type: "uint8" }],
    outputs: [{ name: "usdcPayout", type: "uint256" }, { name: "zeroPayout", type: "uint256" }],
  },
  { name: "pickCell", type: "function", stateMutability: "nonpayable", inputs: [{ name: "cell", type: "uint8" }], outputs: [] },
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "uint256" }], outputs: [] },
];

export const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }],
  },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }],
  },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }],
  },
];

// ═══════════════════════════════════════════════════════════════
// Public Client — Base Mainnet
// ═══════════════════════════════════════════════════════════════
export const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://mainnet.base.org", { timeout: 30_000, retryCount: 2, retryDelay: 1000 }),
    http("https://base.drpc.org", { timeout: 30_000, retryCount: 2, retryDelay: 2000 }),
  ]),
});
