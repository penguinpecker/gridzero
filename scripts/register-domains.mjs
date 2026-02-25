/**
 * GridZero — Register Domains on zkVerify Mainnet
 *
 * Registers 3 aggregation domains:
 *   1. VRF Domain (mining proofs) — aggregation size 16
 *   2. Leaderboard Domain (RISC Zero) — aggregation size 4
 *   3. Difficulty Domain (EZKL) — aggregation size 2
 *
 * Prerequisites:
 *   - VFY tokens in your zkVerify wallet (deposit for domain storage)
 *   - ZKVERIFY_SEED_PHRASE set in .env
 *
 * Usage:
 *   node --loader ts-node/esm scripts/register-domains.mjs
 *   # or
 *   node scripts/register-domains.mjs
 */

import {
  zkVerifySession,
  ZkVerifyEvents,
  Destination,
  AggregateSecurityRules,
  ProofSecurityRules,
} from "zkverifyjs";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const SEED = process.env.ZKVERIFY_SEED_PHRASE;
if (!SEED || SEED.includes("your")) {
  console.error("❌ Set ZKVERIFY_SEED_PHRASE in .env first");
  process.exit(1);
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  GridZero — zkVerify Domain Registration");
  console.log("═══════════════════════════════════════════════════\n");

  // Connect to zkVerify mainnet
  console.log("🔗 Connecting to zkVerify mainnet...");
  const session = await zkVerifySession
    .start()
    .zkVerify()
    .withAccount(SEED);
  console.log("✅ Connected\n");

  const domainOpts = {
    destination: Destination.None,
    aggregateRules: AggregateSecurityRules.Untrusted,
    proofSecurityRules: ProofSecurityRules.Untrusted,
  };

  // 1. VRF Domain — high frequency mining proofs
  console.log("1/3  Registering VRF Domain (aggregation=16, queue=8)...");
  try {
    const vrfResult = await session
      .registerDomain(16, 8, domainOpts)
      .transactionResult;
    console.log(`   ✅ VRF Domain ID: ${vrfResult.domainId}\n`);
    var vrfDomainId = vrfResult.domainId;
  } catch (e) {
    console.error(`   ❌ VRF registration failed: ${e.message}`);
    console.log("   Make sure you have enough VFY for the deposit.\n");
    await session.close();
    process.exit(1);
  }

  // 2. Leaderboard Domain — periodic RISC Zero proofs
  console.log("2/3  Registering Leaderboard Domain (aggregation=4, queue=4)...");
  try {
    const lbResult = await session
      .registerDomain(4, 4, domainOpts)
      .transactionResult;
    console.log(`   ✅ Leaderboard Domain ID: ${lbResult.domainId}\n`);
    var lbDomainId = lbResult.domainId;
  } catch (e) {
    console.error(`   ❌ Leaderboard registration failed: ${e.message}\n`);
  }

  // 3. Difficulty Domain — infrequent EZKL proofs
  console.log("3/3  Registering Difficulty Domain (aggregation=2, queue=2)...");
  try {
    const diffResult = await session
      .registerDomain(2, 2, domainOpts)
      .transactionResult;
    console.log(`   ✅ Difficulty Domain ID: ${diffResult.domainId}\n`);
    var diffDomainId = diffResult.domainId;
  } catch (e) {
    console.error(`   ❌ Difficulty registration failed: ${e.message}\n`);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  DOMAIN REGISTRATION COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  VRF Domain ID:         ${vrfDomainId ?? "FAILED"}`);
  console.log(`  Leaderboard Domain ID: ${lbDomainId ?? "FAILED"}`);
  console.log(`  Difficulty Domain ID:  ${diffDomainId ?? "FAILED"}`);
  console.log("═══════════════════════════════════════════════════");
  console.log("\n  Next: Update your Base contract with these domain IDs:");
  console.log("  npx hardhat console --network base-mainnet");
  console.log(`  > const gz = await ethers.getContractAt("GridZero", "0x561e4419bC46ABfC2EBddC536308674A5b6d1D8f")`);
  console.log(`  > await gz.updateDomainIds(${vrfDomainId ?? 0}, ${lbDomainId ?? 0}, ${diffDomainId ?? 0})`);
  console.log("");

  await session.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
