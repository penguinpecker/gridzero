const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying GridZeroV3 with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // ── Constructor args ──
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";           // USDC on Base
  const ZERO_TOKEN = "0xB68409d54a5a28e9ca6c2B7A54F3DD78E6Eef859";      // ZeroToken on Base
  const FULFILLER = process.env.FULFILLER || deployer.address;           // Resolver bot wallet
  const FEE_RECIPIENT = process.env.FEE_RECIPIENT || deployer.address;   // Protocol fee dest

  console.log("\nConstructor args:");
  console.log("  USDC:          ", USDC);
  console.log("  ZeroToken:     ", ZERO_TOKEN);
  console.log("  Fulfiller:     ", FULFILLER);
  console.log("  Fee Recipient: ", FEE_RECIPIENT);

  // ── Deploy ──
  const GridZeroV3 = await ethers.getContractFactory("GridZeroV3");
  const contract = await GridZeroV3.deploy(USDC, ZERO_TOKEN, FULFILLER, FEE_RECIPIENT);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✓ GridZeroV3 deployed to:", address);
  console.log("\nNext steps:");
  console.log(`  1. Verify: npx hardhat verify --network base ${address} ${USDC} ${ZERO_TOKEN} ${FULFILLER} ${FEE_RECIPIENT}`);
  console.log(`  2. Set Railway env: railway variables set GRIDZERO_V3_ADDRESS=${address}`);
  console.log(`  3. Update frontend contract address`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
