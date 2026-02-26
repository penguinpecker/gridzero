import { ethers } from "hardhat";

/**
 * GridZero V2 Deployment Script — Base Mainnet
 *
 * Deploys:
 *   1. ZeroToken ($ZERO ERC20)
 *   2. GridZeroV2 (round-based game contract)
 *   3. Sets GridZeroV2 as minter on ZeroToken
 *
 * Prerequisites:
 *   - ETH on Base mainnet for gas (~0.002 ETH)
 *   - PRIVATE_KEY set in .env
 *
 * Usage:
 *   npx hardhat run scripts/deploy-v2-base-mainnet.ts --network base-mainnet
 */

// ─── Configuration ────────────────────────────────────────────────

// USDC on Base mainnet
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Fee recipient — set to deployer by default, change later via setFeeRecipient()
// Fulfiller (resolver bot) — set to deployer initially, update after Railway deploy
const FEE_RECIPIENT = process.env.FEE_RECIPIENT || "";
const FULFILLER = process.env.FULFILLER || "";

// ─── Deploy ───────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const feeRecipient = FEE_RECIPIENT || deployer.address;
  const fulfiller = FULFILLER || deployer.address;

  console.log("═══════════════════════════════════════════════════");
  console.log("  GridZero V2 — Base Mainnet Deployment");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Deployer:       ${deployer.address}`);
  console.log(`  Balance:        ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:        Base Mainnet (chain 8453)`);
  console.log(`  USDC:           ${USDC_ADDRESS}`);
  console.log(`  Fee Recipient:  ${feeRecipient}`);
  console.log(`  Fulfiller:      ${fulfiller}`);
  console.log("═══════════════════════════════════════════════════\n");

  if (balance < ethers.parseEther("0.001")) {
    console.error("⚠️  Low balance! Need at least 0.001 ETH for deployment gas.");
    process.exit(1);
  }

  // 1. Deploy ZeroToken
  console.log("1/3  Deploying ZeroToken ($ZERO)...");
  const ZeroToken = await ethers.getContractFactory("ZeroToken");
  const zeroToken = await ZeroToken.deploy();
  await zeroToken.waitForDeployment();
  const zeroAddr = await zeroToken.getAddress();
  console.log(`   ✅ ZeroToken deployed: ${zeroAddr}`);

  // 2. Deploy GridZeroV2
  console.log("2/3  Deploying GridZeroV2...");
  const GridZeroV2 = await ethers.getContractFactory("GridZeroV2");
  const gridZeroV2 = await GridZeroV2.deploy(
    USDC_ADDRESS,
    zeroAddr,
    fulfiller,
    feeRecipient
  );
  await gridZeroV2.waitForDeployment();
  const gridZeroV2Addr = await gridZeroV2.getAddress();
  console.log(`   ✅ GridZeroV2 deployed: ${gridZeroV2Addr}`);

  // 3. Set GridZeroV2 as minter on ZeroToken
  console.log("3/3  Setting GridZeroV2 as $ZERO minter...");
  const minterTx = await zeroToken.setMinter(gridZeroV2Addr, true);
  await minterTx.wait();
  console.log("   ✅ GridZeroV2 set as minter\n");

  // ─── Summary ─────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  ZeroToken:    ${zeroAddr}`);
  console.log(`  GridZeroV2:   ${gridZeroV2Addr}`);
  console.log(`  USDC:         ${USDC_ADDRESS}`);
  console.log(`  Fulfiller:    ${fulfiller}`);
  console.log(`  Fee Recipient:${feeRecipient}`);
  console.log("═══════════════════════════════════════════════════");
  console.log("\n  Next steps:");
  console.log("  1. Verify on BaseScan:");
  console.log(`     npx hardhat verify --network base-mainnet ${zeroAddr}`);
  console.log(`     npx hardhat verify --network base-mainnet ${gridZeroV2Addr} \\`);
  console.log(`       "${USDC_ADDRESS}" "${zeroAddr}" "${fulfiller}" "${feeRecipient}"`);
  console.log("  2. Update GRIDZERO_V2_ADDRESS in gridzero-backend .env");
  console.log("  3. Deploy resolver bot to Railway");
  console.log("  4. Update fulfiller address if using a separate bot wallet:");
  console.log(`     GridZeroV2.setFulfiller(<bot_wallet_address>)`);
  console.log("");

  // Write deployment output
  const output = {
    network: "base-mainnet",
    chainId: 8453,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ZeroToken: zeroAddr,
      GridZeroV2: gridZeroV2Addr,
      USDC: USDC_ADDRESS,
    },
    config: {
      fulfiller,
      feeRecipient,
      entryFee: "1000000",
      roundDuration: 30,
      protocolFeeBps: 1000,
      zeroPerRound: "1000000000000000000",
    },
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployments/v2-base-mainnet.json",
    JSON.stringify(output, null, 2)
  );
  console.log("  📄 Deployment saved to deployments/v2-base-mainnet.json");
}

const fs = require("fs");
if (!fs.existsSync("deployments")) fs.mkdirSync("deployments");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
