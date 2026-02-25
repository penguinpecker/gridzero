// ═══════════════════════════════════════════════════════════════
// GridZero Contract ABIs — Base Mainnet
// GridZero:  0x561e4419bC46ABfC2EBddC536308674A5b6d1D8f
// GridZeroOre: 0x5AAA886aEb136F9AaeC967CA988f459639cd8954
// zkVerify Attestation: 0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69
// ═══════════════════════════════════════════════════════════════

export const GRID_ABI = [
  // ─── Read Functions ───
  {
    name: "getCell",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "x", type: "uint8" },
      { name: "y", type: "uint8" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "player", type: "address" },
          { name: "gridX", type: "uint8" },
          { name: "gridY", type: "uint8" },
          { name: "oreType", type: "uint8" },
          { name: "isRare", type: "bool" },
          { name: "randomOutput", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "isMined",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "x", type: "uint8" },
      { name: "y", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isSettled",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "x", type: "uint8" },
      { name: "y", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getPlayerStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "totalMined", type: "uint256" },
          { name: "score", type: "uint256" },
          { name: "oreInventory", type: "uint256[8]" },
          { name: "lastMineBlock", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getPlayerScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalMined",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "difficultyThreshold",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "vrfDomainId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "leaderboardDomainId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "difficultyDomainId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "vrfVkeyHash",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getTopPlayers",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "isAggregationVerified",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "domainId", type: "uint256" },
      { name: "aggregationId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "GRID_SIZE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "computeGroth16Leaf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "publicInputsHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "changeEndianness",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "input", type: "uint256" }],
    outputs: [{ name: "v", type: "uint256" }],
  },

  // ─── Write Functions ───
  {
    name: "recordMining",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "gridX", type: "uint8" },
      { name: "gridY", type: "uint8" },
      { name: "oreType", type: "uint8" },
      { name: "isRare", type: "bool" },
      { name: "randomOutput", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "settleMining",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gridX", type: "uint8" },
      { name: "gridY", type: "uint8" },
      { name: "_domainId", type: "uint256" },
      { name: "_aggregationId", type: "uint256" },
      { name: "_leaf", type: "bytes32" },
      { name: "_merklePath", type: "bytes32[]" },
      { name: "_leafCount", type: "uint256" },
      { name: "_index", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "batchSettleMining",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gridXs", type: "uint8[]" },
      { name: "gridYs", type: "uint8[]" },
      { name: "_domainId", type: "uint256" },
      { name: "_aggregationId", type: "uint256" },
      { name: "_leaves", type: "bytes32[]" },
      { name: "_merklePaths", type: "bytes32[][]" },
      { name: "_leafCounts", type: "uint256[]" },
      { name: "_indices", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "updateDifficulty",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newThreshold", type: "uint256" },
      { name: "_domainId", type: "uint256" },
      { name: "_aggregationId", type: "uint256" },
      { name: "_leaf", type: "bytes32" },
      { name: "_merklePath", type: "bytes32[]" },
      { name: "_leafCount", type: "uint256" },
      { name: "_index", type: "uint256" },
    ],
    outputs: [],
  },

  // ─── Events ───
  {
    name: "CellMined",
    type: "event",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "gridX", type: "uint8", indexed: false },
      { name: "gridY", type: "uint8", indexed: false },
      { name: "oreType", type: "uint8", indexed: false },
      { name: "isRare", type: "bool", indexed: false },
      { name: "score", type: "uint256", indexed: false },
    ],
  },
  {
    name: "MiningSettled",
    type: "event",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "gridX", type: "uint8", indexed: false },
      { name: "gridY", type: "uint8", indexed: false },
      { name: "domainId", type: "uint256", indexed: false },
      { name: "aggregationId", type: "uint256", indexed: false },
    ],
  },
  {
    name: "DifficultyUpdated",
    type: "event",
    inputs: [
      { name: "oldThreshold", type: "uint256", indexed: false },
      { name: "newThreshold", type: "uint256", indexed: false },
    ],
  },
];

export const ORE_TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOfBatch",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "ids", type: "uint256[]" },
    ],
    outputs: [{ name: "", type: "uint256[]" }],
  },
];
