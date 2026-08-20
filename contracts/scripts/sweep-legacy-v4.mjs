// Sweeps the remaining USDC out of the superseded V4 game contract.
// V4's owner is the resolver wallet, so emergencyWithdrawUSDC() sends the
// balance to that wallet (owner()), which is a key we hold.
// Reads the operator key from the local env file, never logs it.
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

const ENV_PATH = process.argv[2];
if (!ENV_PATH) throw new Error("usage: node sweep-legacy-v4.mjs <path-to-env-file>");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

let key = env.RESOLVER_PRIVATE_KEY;
if (!key) throw new Error("RESOLVER_PRIVATE_KEY missing from env file");
if (!key.startsWith("0x")) key = "0x" + key;

const V4 = "0x58497ADCc524ee9a0DA11900af32bFa973fE55d3";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const transport = http("https://mainnet.base.org", { retryCount: 6, retryDelay: 2000, timeout: 30_000 });
const account = privateKeyToAccount(key);
const pc = createPublicClient({ chain: base, transport });
const wc = createWalletClient({ account, chain: base, transport });

const erc20 = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const ownerAbi = [{ name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }];
const sweepAbi = [{ name: "emergencyWithdrawUSDC", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }];

const bal = (who) => pc.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [who] });

const owner = await pc.readContract({ address: V4, abi: ownerAbi, functionName: "owner" });
const isOwner = owner.toLowerCase() === account.address.toLowerCase();
console.log("V4 owner       :", owner);
console.log("sweeping as    :", account.address, isOwner ? "(MATCH)" : "(MISMATCH — would revert)");
if (!isOwner) { console.error("aborting: signer is not the owner"); process.exit(1); }

const before = await bal(V4);
const mineBefore = await bal(account.address);
console.log("V4 USDC before :", formatUnits(before, 6));
console.log("wallet before  :", formatUnits(mineBefore, 6));
if (before === 0n) { console.log("nothing to sweep"); process.exit(0); }

const hash = await wc.writeContract({ address: V4, abi: sweepAbi, functionName: "emergencyWithdrawUSDC" });
console.log("sweep tx       :", hash);
const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log("status         :", r.status, "| gas:", r.gasUsed.toString());

await new Promise((res) => setTimeout(res, 6000));
const after = await bal(V4);
const mineAfter = await bal(account.address);
console.log("V4 USDC after  :", formatUnits(after, 6));
console.log("wallet after   :", formatUnits(mineAfter, 6));
console.log("recovered      :", formatUnits(mineAfter - mineBefore, 6), "USDC");
if (after !== 0n) console.log("NOTE: a non-zero remainder means new fees accrued between read and sweep");
