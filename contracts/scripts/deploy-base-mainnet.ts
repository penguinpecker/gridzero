import { ethers } from "hardhat";

/**
 * GridZero Deployment Script — Base Mainnet
 *
 * Deploys:
 *   1. GridZero (main game contract)
 *   2. GridZeroOre (ERC1155 ore tokens)
 *   3. Links ore contract to game contract
 *
 * Prerequisites:
 *   - ETH on Base mainnet for gas (~0.001 ETH)
 *   - PRIVATE_KEY set in .env
 *   - Domain IDs from zkVerify mainnet (register domains first)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base-mainnet.ts --network base-mainnet
 */

// ─── Configuration ────────────────────────────────────────────────
// zkVerify attestation contract on Base mainnet (ZkVerifyAggregationGlobal proxy)
const ZKVERIFY_ATTESTATION = "0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69";

// Domain IDs — set these after registering domains on zkVerify mainnet
// Use 0 as placeholder; update via updateDomainIds() after registration
const VRF_DOMAIN_ID       = process.env.VRF_DOMAIN_ID       ? parseInt(process.env.VRF_DOMAIN_ID)       : 0;
const LEADERBOARD_DOMAIN_ID = process.env.LEADERBOARD_DOMAIN_ID ? parseInt(process.env.LEADERBOARD_DOMAIN_ID) : 0;
const DIFFICULTY_DOMAIN_ID = process.env.DIFFICULTY_DOMAIN_ID ? parseInt(process.env.DIFFICULTY_DOMAIN_ID) : 0;

// Ore token metadata URI
const ORE_METADATA_URI = "https://gridzero.xyz/api/ore/{id}.json";

// ─── Deploy ───────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════════");
  console.log("  GridZero — Base Mainnet Deployment");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:   Base Mainnet (chain 8453)`);
  console.log(`  zkVerify:  ${ZKVERIFY_ATTESTATION}`);
  console.log(`  Domains:   VRF=${VRF_DOMAIN_ID} LB=${LEADERBOARD_DOMAIN_ID} DIFF=${DIFFICULTY_DOMAIN_ID}`);
  console.log("═══════════════════════════════════════════════════\n");

  if (balance < ethers.parseEther("0.0005")) {
    console.error("⚠️  Low balance! Need at least 0.0005 ETH for deployment gas.");
    process.exit(1);
  }

  // 1. Deploy GridZero
  console.log("1/3  Deploying GridZero...");
  const GridZero = await ethers.getContractFactory("GridZero");
  const gridZero = await GridZero.deploy(
    ZKVERIFY_ATTESTATION,
    VRF_DOMAIN_ID,
    LEADERBOARD_DOMAIN_ID,
    DIFFICULTY_DOMAIN_ID
  );
  await gridZero.waitForDeployment();
  const gridZeroAddr = await gridZero.getAddress();
  console.log(`   ✅ GridZero deployed: ${gridZeroAddr}`);

  // 2. Deploy GridZeroOre
  console.log("2/3  Deploying GridZeroOre...");
  const GridZeroOre = await ethers.getContractFactory("GridZeroOre");
  const ore = await GridZeroOre.deploy(ORE_METADATA_URI);
  await ore.waitForDeployment();
  const oreAddr = await ore.getAddress();
  console.log(`   ✅ GridZeroOre deployed: ${oreAddr}`);

  // 3. Link ore to game contract
  console.log("3/3  Linking ore contract to game...");
  const linkTx = await ore.setGameContract(gridZeroAddr);
  await linkTx.wait();
  console.log("   ✅ Ore contract linked to GridZero\n");

  // ─── Summary ─────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  GridZero:     ${gridZeroAddr}`);
  console.log(`  GridZeroOre:  ${oreAddr}`);
  console.log(`  zkVerify:     ${ZKVERIFY_ATTESTATION}`);
  console.log("═══════════════════════════════════════════════════");
  console.log("\n  Next steps:");
  console.log("  1. Verify on BaseScan:");
  console.log(`     npx hardhat verify --network base-mainnet ${gridZeroAddr} \\`);
  console.log(`       "${ZKVERIFY_ATTESTATION}" ${VRF_DOMAIN_ID} ${LEADERBOARD_DOMAIN_ID} ${DIFFICULTY_DOMAIN_ID}`);
  console.log(`     npx hardhat verify --network base-mainnet ${oreAddr} \\`);
  console.log(`       "${ORE_METADATA_URI}"`);
  console.log("  2. Register domains on zkVerify mainnet, then call:");
  console.log(`     gridZero.updateDomainIds(vrfDomainId, lbDomainId, diffDomainId)`);
  console.log("  3. Set verification key hashes:");
  console.log(`     gridZero.setVkeyHashes(vrfVkey, lbVkey, diffVkey)`);
  console.log("");

  // Write deployment output
  const output = {
    network: "base-mainnet",
    chainId: 8453,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      GridZero: gridZeroAddr,
      GridZeroOre: oreAddr,
      ZkVerifyAttestation: ZKVERIFY_ATTESTATION,
    },
    config: {
      vrfDomainId: VRF_DOMAIN_ID,
      leaderboardDomainId: LEADERBOARD_DOMAIN_ID,
      difficultyDomainId: DIFFICULTY_DOMAIN_ID,
    },
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployments/base-mainnet.json",
    JSON.stringify(output, null, 2)
  );
  console.log("  📄 Deployment saved to deployments/base-mainnet.json");
}

// Ensure deployments directory exists
const fs = require("fs");
if (!fs.existsSync("deployments")) fs.mkdirSync("deployments");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
