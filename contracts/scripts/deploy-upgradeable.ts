import { ethers, upgrades, network, run } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const GZ = "src/upgradeable/GridZero.sol:GridZero";
const ZT = "src/upgradeable/ZeroToken.sol:ZeroToken";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const fulfiller = process.env.FULFILLER!;
  const feeRecipient = process.env.FEE_RECIPIENT!;
  if (!ethers.isAddress(fulfiller)) throw new Error("FULFILLER not set to a valid address");
  if (!ethers.isAddress(feeRecipient)) throw new Error("FEE_RECIPIENT not set to a valid address");

  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("network      :", network.name, "chainId", net.chainId.toString());
  console.log("deployer     :", deployer.address);
  console.log("balance      :", ethers.formatEther(bal), "ETH");
  console.log("fulfiller    :", fulfiller);
  console.log("feeRecipient :", feeRecipient);
  console.log("usdc         :", USDC_BASE);
  if (bal === 0n) throw new Error("deployer has no gas");

  // ─── ZeroToken (UUPS proxy) ───
  // Reuse an already-deployed proxy when set, so a mid-run RPC hiccup does not
  // cost a second deployment.
  const ZeroToken = await ethers.getContractFactory(ZT);
  let zero: any;
  if (process.env.ZERO_TOKEN_PROXY && ethers.isAddress(process.env.ZERO_TOKEN_PROXY)) {
    zero = ZeroToken.attach(process.env.ZERO_TOKEN_PROXY);
    console.log("\nreusing existing ZeroToken proxy");
  } else {
    zero = await upgrades.deployProxy(ZeroToken, [deployer.address], { kind: "uups" });
    await zero.waitForDeployment();
  }
  const zeroAddr = await zero.getAddress();
  const zeroImpl = await upgrades.erc1967.getImplementationAddress(zeroAddr);
  console.log("\nZeroToken proxy :", zeroAddr);
  console.log("ZeroToken impl  :", zeroImpl);

  // ─── GridZero (UUPS proxy) ───
  const GridZero = await ethers.getContractFactory(GZ);
  const game = await upgrades.deployProxy(
    GridZero,
    [USDC_BASE, zeroAddr, fulfiller, feeRecipient, deployer.address],
    { kind: "uups" }
  );
  await game.waitForDeployment();
  const gameAddr = await game.getAddress();
  const gameImpl = await upgrades.erc1967.getImplementationAddress(gameAddr);
  console.log("GridZero proxy  :", gameAddr);
  console.log("GridZero impl   :", gameImpl);

  // ─── Wire the minter role (the bug that bricked the previous deployment) ───
  const tx = await zero.setMinter(gameAddr, true);
  await tx.wait();
  console.log("\nsetMinter tx    :", tx.hash);

  // ─── Post-deploy assertions ───
  const checks: [string, unknown, unknown][] = [
    ["zero.minters(game)", await zero.minters(gameAddr), true],
    ["game.owner", await game.owner(), deployer.address],
    ["game.fulfiller", await game.fulfiller(), fulfiller],
    ["game.feeRecipient", await game.feeRecipient(), feeRecipient],
    ["game.usdc", await game.usdc(), USDC_BASE],
    ["game.zeroToken", await game.zeroToken(), zeroAddr],
    ["game.entryFee", (await game.entryFee()).toString(), "1000000"],
    ["zero.owner", await zero.owner(), deployer.address],
  ];
  console.log("\n─── post-deploy checks ───");
  let failed = 0;
  for (const [name, got, want] of checks) {
    const ok = String(got).toLowerCase() === String(want).toLowerCase();
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name} = ${got}${ok ? "" : ` (expected ${want})`}`);
  }
  const roundId = await game.currentRoundId();
  console.log(`OK   game.currentRoundId = ${roundId}`);
  if (failed > 0) throw new Error(`${failed} post-deploy checks failed`);

  // ─── Record ───
  const record = {
    network: network.name,
    chainId: Number(net.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    pattern: "UUPS (ERC1967)",
    contracts: {
      GridZero: { proxy: gameAddr, implementation: gameImpl },
      ZeroToken: { proxy: zeroAddr, implementation: zeroImpl },
      USDC: USDC_BASE,
    },
    config: { fulfiller, feeRecipient, entryFee: "1000000", roundDuration: 30, protocolFeeBps: 500 },
  };
  const dir = join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `upgradeable-${net.chainId}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log("\nrecord written  :", file);

  // ─── Verify on Basescan ───
  if (process.env.BASESCAN_API_KEY) {
    console.log("\n─── verifying implementations ───");
    for (const [label, addr] of [["ZeroToken", zeroImpl], ["GridZero", gameImpl]] as const) {
      try {
        await run("verify:verify", { address: addr, constructorArguments: [] });
        console.log(`verified ${label} impl ${addr}`);
      } catch (e: any) {
        const m = String(e?.message || e);
        console.log(`${label} impl verify: ${m.includes("Already Verified") ? "already verified" : m.slice(0, 160)}`);
      }
    }
  }

  console.log("\nDONE");
  console.log("GridZero  :", gameAddr);
  console.log("ZeroToken :", zeroAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
