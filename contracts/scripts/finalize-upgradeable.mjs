// Finishes the mainnet UUPS deployment after the proxies are live:
// wires the minter role, asserts every post-deploy invariant, writes the record.
// Uses viem with a retrying fallback transport because the Hardhat plugin's
// read-immediately-after-deploy pattern races against public Base RPCs.
import { createPublicClient, createWalletClient, http, fallback } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const GAME = "0xCBFF780A019524a3aE909758f6A6E6108A2A63D5";
const ZERO = "0xB13ebbb116fFcA7DF2B7467170D691DF671620A8";
const GAME_IMPL = "0xf4ee8fd3611ce7e22dcd9c456249f0802f9fca51";
const ZERO_IMPL = "0xCbc050A94f94b1283b7Ea6250cC50FD331C93330";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// drpc's public tier 429s under back-to-back reads, so it is not in the pool.
const transport = fallback([
  http("https://mainnet.base.org", { timeout: 30_000, retryCount: 6, retryDelay: 2000 }),
]);

const pc = createPublicClient({ chain: base, transport });
const account = privateKeyToAccount(env.PRIVATE_KEY.startsWith("0x") ? env.PRIVATE_KEY : "0x" + env.PRIVATE_KEY);
const wc = createWalletClient({ account, chain: base, transport });

const view = (n, t) => [{ name: n, type: "function", stateMutability: "view", inputs: [], outputs: [{ type: t }] }];
const minters = [{ name: "minters", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] }];
const setMinter = [{ name: "setMinter", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] }];

async function read(address, abi, functionName, args) {
  for (let i = 0; i < 6; i++) {
    try { return await pc.readContract({ address, abi, functionName, args }); }
    catch (e) { if (i === 5) throw e; await new Promise((r) => setTimeout(r, 2000)); }
  }
}

console.log("deployer:", account.address);

// ─── Wire the minter role ───
let isMinter = await read(ZERO, minters, "minters", [GAME]);
if (isMinter) {
  console.log("minter role: already set");
} else {
  console.log("granting minter role to the game contract...");
  const hash = await wc.writeContract({ address: ZERO, abi: setMinter, functionName: "setMinter", args: [GAME, true] });
  console.log("setMinter tx:", hash);
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log("status:", r.status, "| gas:", r.gasUsed.toString());
  isMinter = await read(ZERO, minters, "minters", [GAME]);
}

// ─── Post-deploy invariants ───
const checks = [
  ["zero.minters(game)", String(isMinter), "true"],
  ["game.owner", await read(GAME, view("owner", "address"), "owner"), account.address],
  ["game.fulfiller", await read(GAME, view("fulfiller", "address"), "fulfiller"), env.FULFILLER],
  ["game.feeRecipient", await read(GAME, view("feeRecipient", "address"), "feeRecipient"), env.FEE_RECIPIENT],
  ["game.usdc", await read(GAME, view("usdc", "address"), "usdc"), USDC],
  ["game.zeroToken", await read(GAME, view("zeroToken", "address"), "zeroToken"), ZERO],
  ["game.entryFee", String(await read(GAME, view("entryFee", "uint256"), "entryFee")), "1000000"],
  ["game.roundDuration", String(await read(GAME, view("roundDuration", "uint256"), "roundDuration")), "30"],
  ["game.protocolFeeBps", String(await read(GAME, view("protocolFeeBps", "uint256"), "protocolFeeBps")), "500"],
  ["zero.owner", await read(ZERO, view("owner", "address"), "owner"), account.address],
  ["zero.symbol", await read(ZERO, view("symbol", "string"), "symbol"), "ZERO"],
];

console.log("\n─── post-deploy checks ───");
let failed = 0;
for (const [name, got, want] of checks) {
  const ok = String(got).toLowerCase() === String(want).toLowerCase();
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} = ${got}${ok ? "" : `  (expected ${want})`}`);
}
const rid = await read(GAME, view("currentRoundId", "uint256"), "currentRoundId");
console.log(`OK   game.currentRoundId = ${rid}`);

// implementations must be real code, and must NOT be the proxies
for (const [label, addr] of [["GridZero impl", GAME_IMPL], ["ZeroToken impl", ZERO_IMPL]]) {
  const code = await pc.getCode({ address: addr });
  const ok = code && code !== "0x";
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label} has code (${ok ? (code.length - 2) / 2 : 0} bytes)`);
}

if (failed) { console.error(`\n${failed} CHECK(S) FAILED`); process.exit(1); }

const record = {
  network: "base-mainnet",
  chainId: 8453,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  pattern: "UUPS (ERC1967)",
  contracts: {
    GridZero: { proxy: GAME, implementation: GAME_IMPL },
    ZeroToken: { proxy: ZERO, implementation: ZERO_IMPL },
    USDC,
  },
  config: {
    fulfiller: env.FULFILLER,
    feeRecipient: env.FEE_RECIPIENT,
    entryFee: "1000000",
    roundDuration: 30,
    protocolFeeBps: 500,
  },
};
mkdirSync(join(root, "deployments"), { recursive: true });
const file = join(root, "deployments", "upgradeable-8453.json");
writeFileSync(file, JSON.stringify(record, null, 2));
console.log("\nrecord written:", file);
console.log("\nALL CHECKS PASSED");
console.log("GridZero  proxy:", GAME);
console.log("ZeroToken proxy:", ZERO);
