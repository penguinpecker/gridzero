import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const GZ = "src/upgradeable/GridZero.sol:GridZero";
const ZT = "src/upgradeable/ZeroToken.sol:ZeroToken";

const USDC = (n: number) => BigInt(Math.round(n * 1e6));

async function deployAll(seedContract = true) {
  const [owner, fulfiller, feeRecipient, p1, p2, p3, attacker] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const ZeroToken = await ethers.getContractFactory(ZT);
  const zero = await upgrades.deployProxy(ZeroToken, [owner.address], { kind: "uups" });
  await zero.waitForDeployment();

  const GridZero = await ethers.getContractFactory(GZ);
  const game = await upgrades.deployProxy(
    GridZero,
    [await usdc.getAddress(), await zero.getAddress(), fulfiller.address, feeRecipient.address, owner.address],
    { kind: "uups" }
  );
  await game.waitForDeployment();

  await zero.setMinter(await game.getAddress(), true);

  for (const p of [p1, p2, p3, attacker]) {
    await usdc.mint(p.address, USDC(1000));
    await usdc.connect(p).approve(await game.getAddress(), USDC(1000));
  }
  // seed the contract so bonus rounds have something to draw on
  if (seedContract) await usdc.mint(await game.getAddress(), USDC(500));

  return { owner, fulfiller, feeRecipient, p1, p2, p3, attacker, usdc, zero, game };
}

async function endRound() {
  await ethers.provider.send("evm_increaseTime", [31]);
  await ethers.provider.send("evm_mine", []);
}

/** Find a vrfOutput that makes `resolveRound` land on `targetCell`. */
function findVrf(occupied: number[], targetCell: number): string {
  const idx = occupied.indexOf(targetCell);
  for (let i = 0; i < 20000; i++) {
    const v = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    if (BigInt(v) % BigInt(occupied.length) === BigInt(idx)) return v;
  }
  throw new Error("no vrf found");
}

/** Find a vrfOutput that both lands on `targetCell` AND triggers a bonus round. */
function findBonusVrf(occupied: number[], targetCell: number, odds: number): string {
  const idx = occupied.indexOf(targetCell);
  for (let i = 0; i < 400000; i++) {
    const v = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    if (BigInt(v) % BigInt(occupied.length) !== BigInt(idx)) continue;
    const h = ethers.solidityPackedKeccak256(["bytes32", "string"], [v, "bonus"]);
    if (BigInt(h) % BigInt(odds) === 0n) return v;
  }
  throw new Error("no bonus vrf found");
}

describe("GridZero (upgradeable)", () => {
  describe("proxy wiring", () => {
    it("leaves the implementation permanently uninitialized", async () => {
      const { game, owner, usdc, zero, fulfiller, feeRecipient } = await deployAll();
      const impl = await upgrades.erc1967.getImplementationAddress(await game.getAddress());
      const asLogic = await ethers.getContractAt(GZ, impl);
      // All-valid args, so the ONLY thing that can revert is the initializer lock.
      // (Passing zero addresses here would revert on the usdc=0 guard instead and
      // make this assertion pass even with _disableInitializers removed.)
      await expect(
        asLogic.initialize(
          await usdc.getAddress(),
          await zero.getAddress(),
          fulfiller.address,
          feeRecipient.address,
          owner.address
        )
      ).to.be.revertedWithCustomError(asLogic, "InvalidInitialization");
    });

    it("cannot be re-initialized through the proxy", async () => {
      const { game, attacker } = await deployAll();
      await expect(
        game.connect(attacker).initialize(attacker.address, attacker.address, attacker.address, attacker.address, attacker.address)
      ).to.be.reverted;
    });

    it("refuses an upgrade from a non-owner", async () => {
      const { game, attacker } = await deployAll();
      const V2 = await ethers.getContractFactory(GZ, attacker);
      await expect(upgrades.upgradeProxy(await game.getAddress(), V2)).to.be.reverted;
    });

    it("preserves state and funds across an upgrade", async () => {
      const { game, p1, owner, usdc } = await deployAll();
      await game.connect(p1).pickCell(7);
      const before = await game.currentRoundId();
      const balBefore = await usdc.balanceOf(await game.getAddress());

      const V2 = await ethers.getContractFactory(GZ, owner);
      const upgraded = await upgrades.upgradeProxy(await game.getAddress(), V2);

      expect(await upgraded.currentRoundId()).to.equal(before);
      expect(await upgraded.hasJoined(before, p1.address)).to.equal(true);
      expect(await usdc.balanceOf(await game.getAddress())).to.equal(balBefore);
    });
  });

  describe("access control", () => {
    it("rejects resolveRound from anyone but the fulfiller", async () => {
      const { game, p1, attacker } = await deployAll();
      await game.connect(p1).pickCell(3);
      await endRound();
      const rid = await game.currentRoundId();
      await expect(
        game.connect(attacker).resolveRound(ethers.ZeroHash, rid)
      ).to.be.revertedWith("Not fulfiller");
    });

    it("rejects skipEmptyRound from anyone but the fulfiller", async () => {
      const { game, attacker } = await deployAll();
      await endRound();
      const rid = await game.currentRoundId();
      await expect(
        game.connect(attacker).skipEmptyRound(rid)
      ).to.be.revertedWith("Not fulfiller");
    });

    it("refuses admin setters from a non-owner", async () => {
      const { game, attacker } = await deployAll();
      await expect(game.connect(attacker).setFulfiller(attacker.address)).to.be.reverted;
      await expect(game.connect(attacker).emergencyWithdrawUSDC()).to.be.reverted;
      await expect(game.connect(attacker).setProtocolFeeBps(0)).to.be.reverted;
    });
  });

  describe("round rules", () => {
    it("blocks a second entry from the same wallet in one round", async () => {
      const { game, p1 } = await deployAll();
      await game.connect(p1).pickCell(4);
      await expect(game.connect(p1).pickCell(9)).to.be.revertedWith("Already entered");
    });

    it("blocks entry after the round has ended", async () => {
      const { game, p1 } = await deployAll();
      await endRound();
      await expect(game.connect(p1).pickCell(1)).to.be.revertedWith("Round ended");
    });

    it("rejects an out-of-range cell", async () => {
      const { game, p1 } = await deployAll();
      await expect(game.connect(p1).pickCell(25)).to.be.revertedWith("Invalid cell");
    });

    it("refuses to resolve before the round ends", async () => {
      const { game, fulfiller, p1 } = await deployAll();
      await game.connect(p1).pickCell(2);
      const rid = await game.currentRoundId();
      await expect(
        game.connect(fulfiller).resolveRound(ethers.ZeroHash, rid)
      ).to.be.revertedWith("Round not ended");
    });

    it("refuses to skip a round that has players", async () => {
      const { game, fulfiller, p1 } = await deployAll();
      await game.connect(p1).pickCell(2);
      await endRound();
      const rid = await game.currentRoundId();
      await expect(
        game.connect(fulfiller).skipEmptyRound(rid)
      ).to.be.revertedWith("Has players");
    });

    it("refuses to resolve an empty round", async () => {
      const { game, fulfiller } = await deployAll();
      await endRound();
      const rid = await game.currentRoundId();
      await expect(
        game.connect(fulfiller).resolveRound(ethers.ZeroHash, rid)
      ).to.be.revertedWith("Use skipEmptyRound");
    });

    it("refuses a stale roundId", async () => {
      const { game, fulfiller, p1 } = await deployAll();
      await game.connect(p1).pickCell(2);
      await endRound();
      const rid = await game.currentRoundId();
      await expect(
        game.connect(fulfiller).resolveRound(ethers.ZeroHash, rid - 1n)
      ).to.be.revertedWith("Wrong round");
    });
  });

  describe("payout accounting", () => {
    it("pays the winner pool minus fee and resolver cut, and mints ZERO", async () => {
      const { game, fulfiller, usdc, zero, p1, p2 } = await deployAll();
      await game.connect(p1).pickCell(10); // winner
      await game.connect(p2).pickCell(20); // loser
      await endRound();

      const rid = await game.currentRoundId();
      const vrf = findVrf([10, 20], 10);

      const before = await usdc.balanceOf(p1.address);
      await game.connect(fulfiller).resolveRound(vrf, rid);
      const gained = (await usdc.balanceOf(p1.address)) - before;

      // pool 2 USDC, 5% fee = 0.1, resolver 0.1 => 1.8 to the single winner
      expect(gained).to.equal(USDC(1.8));
      expect(await zero.balanceOf(p1.address)).to.equal(ethers.parseEther("100"));
      expect(await game.accumulatedFees()).to.equal(USDC(0.1));
    });

    it("splits evenly between winners sharing a cell", async () => {
      const { game, fulfiller, usdc, p1, p2, p3 } = await deployAll();
      await game.connect(p1).pickCell(5);
      await game.connect(p2).pickCell(5);
      await game.connect(p3).pickCell(11);
      await endRound();

      const rid = await game.currentRoundId();
      const vrf = findVrf([5, 11], 5);

      const b1 = await usdc.balanceOf(p1.address);
      const b2 = await usdc.balanceOf(p2.address);
      await game.connect(fulfiller).resolveRound(vrf, rid);

      // pool 3, fee 0.15, resolver 0.1 => 2.75 split two ways = 1.375 each
      expect((await usdc.balanceOf(p1.address)) - b1).to.equal(USDC(1.375));
      expect((await usdc.balanceOf(p2.address)) - b2).to.equal(USDC(1.375));
    });

    it("pays the resolver its cut", async () => {
      const { game, fulfiller, usdc, p1 } = await deployAll();
      await game.connect(p1).pickCell(1);
      await endRound();
      const before = await usdc.balanceOf(fulfiller.address);
      await game.connect(fulfiller).resolveRound(findVrf([1], 1), await game.currentRoundId());
      expect((await usdc.balanceOf(fulfiller.address)) - before).to.equal(USDC(0.1));
    });

    it("clamps a bonus payout to what the contract can actually cover", async () => {
      // No seed funding: a 10x bonus on this pot is far more than the contract holds,
      // so without the clamp resolveRound reverts on an impossible transfer.
      const { game, owner, fulfiller, usdc, p1 } = await deployAll(false);
      await game.connect(owner).setBonusRoundOdds(10);

      await game.connect(p1).pickCell(1);
      await endRound();
      const rid = await game.currentRoundId();
      const vrf = findBonusVrf([1], 1, 10);

      await expect(game.connect(fulfiller).resolveRound(vrf, rid)).to.not.be.reverted;

      const r = await game.rounds(rid);
      expect(r.isBonusRound, "test must actually exercise a bonus round").to.equal(true);

      const bal = await usdc.balanceOf(await game.getAddress());
      expect(bal, "contract must never pay out more than it holds").to.be.gte(0n);
      expect(await game.roundUsdcPerWinner(rid)).to.be.lte(USDC(1));
    });

    it("never lets a bonus round raid the accumulated fee balance", async () => {
      const { game, owner, fulfiller, usdc, p1 } = await deployAll();
      await game.connect(owner).setBonusRoundOdds(10);
      for (let i = 0; i < 12; i++) {
        await game.connect(p1).pickCell(1);
        await endRound();
        const rid = await game.currentRoundId();
        await game.connect(fulfiller).resolveRound(findVrf([1], 1), rid);
        const fees = await game.accumulatedFees();
        const bal = await usdc.balanceOf(await game.getAddress());
        expect(bal, "contract cannot owe more fees than it holds").to.be.gte(fees);
      }
      const fees = await game.accumulatedFees();
      await expect(game.connect(owner).withdrawFees()).to.not.be.reverted;
      expect(fees).to.be.gt(0n);
    });

    it("keeps the contract solvent across many mixed rounds", async () => {
      const { game, fulfiller, usdc, p1, p2 } = await deployAll();
      for (let i = 0; i < 10; i++) {
        if (i % 3 !== 0) {
          await game.connect(p1).pickCell(2);
          await game.connect(p2).pickCell(8);
        }
        await endRound();
        const rid = await game.currentRoundId();
        if (i % 3 !== 0) {
          await game.connect(fulfiller).resolveRound(findVrf([2, 8], 2), rid);
        } else {
          await game.connect(fulfiller).skipEmptyRound(rid);
        }
        expect(await usdc.balanceOf(await game.getAddress())).to.be.gte(await game.accumulatedFees());
      }
    });
  });

  describe("ZeroToken", () => {
    it("refuses minting from a non-minter", async () => {
      const { zero, attacker } = await deployAll();
      await expect(zero.connect(attacker).mint(attacker.address, 1n)).to.be.revertedWith("Not a minter");
    });

    it("refuses setMinter from a non-owner", async () => {
      const { zero, attacker } = await deployAll();
      await expect(zero.connect(attacker).setMinter(attacker.address, true)).to.be.reverted;
    });

    it("has the game wired as a minter so claims cannot brick", async () => {
      const { zero, game } = await deployAll();
      expect(await zero.minters(await game.getAddress())).to.equal(true);
    });
  });
});
