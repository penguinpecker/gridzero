// GridZero V2 — Contract Config (Base Mainnet)

export const CONTRACTS = {
  GRIDZERO_V2: '0xAd38008DF25909366d23f4b12dEADBD8cC586a26',
  ZERO_TOKEN: '0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

export const CHAIN_ID = 8453;

export const GRIDZERO_ABI = [
  // Read
  'function currentRoundId() view returns (uint256)',
  'function rounds(uint256) view returns (uint64 startTime, uint64 endTime, uint256 totalDeposits, uint256 totalPlayers, uint8 winningCell, bool resolved, bool pendingVRF, bool isBonusRound, bool claimed)',
  'function getCellCounts(uint256 roundId) view returns (uint256[25])',
  'function getCellPlayers(uint256 roundId, uint8 cell) view returns (address[])',
  'function playerCell(uint256 roundId, address player) view returns (uint8)',
  'function hasClaimed(uint256 roundId, address player) view returns (bool)',
  'function isWinner(uint256 roundId, address player) view returns (bool)',
  'function getCurrentRound() view returns (uint256 roundId, uint64 startTime, uint64 endTime, uint256 totalDeposits, uint256 totalPlayers, uint256 timeRemaining)',
  'function getPotentialPayout(uint8 cell) view returns (uint256 usdcPayout, uint256 zeroPayout)',
  'function entryFee() view returns (uint256)',
  // Write
  'function pickCell(uint8 cell)',
  'function claim(uint256 roundId)',
  // Events
  'event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 endTime)',
  'event CellPicked(uint256 indexed roundId, address indexed player, uint8 cell)',
  'event RoundResolved(uint256 indexed roundId, uint8 winningCell, uint256 winnersCount, bool isBonusRound)',
  'event WinningsClaimed(uint256 indexed roundId, address indexed player, uint256 usdcAmount, uint256 zeroAmount)',
];

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];
