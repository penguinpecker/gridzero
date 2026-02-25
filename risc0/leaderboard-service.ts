import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { GridZeroZkService } from "../services/zkverify-service";

/**
 * GridZero Leaderboard Proof Service
 *
 * Generates RISC Zero proofs for leaderboard verification
 * and submits them to zkVerify.
 *
 * Flow:
 * 1. Collect player's mining history from game state
 * 2. Write input JSON for RISC Zero host program
 * 3. Execute Rust host to generate proof
 * 4. Read proof artifacts
 * 5. Submit to zkVerify via zkverifyjs
 */
export class LeaderboardProofService {
  private zkService: GridZeroZkService;
  private risc0Dir: string;

  constructor(zkService: GridZeroZkService) {
    this.zkService = zkService;
    this.risc0Dir = path.join(__dirname, "../risc0");
  }

  /**
   * Generate and submit a leaderboard proof for a player
   */
  async proveAndSubmit(
    playerAddress: string,
    miningHistory: MiningRecord[]
  ): Promise<{
    score: number;
    totalMined: number;
    verified: boolean;
  }> {
    console.log(
      `📊 Generating leaderboard proof for ${playerAddress.slice(0, 10)}...`
    );

    // Step 1: Prepare input
    const input = {
      player_address: this.addressToBytes(playerAddress),
      mining_history: miningHistory,
    };

    const inputPath = path.join(this.risc0Dir, "input.json");
    fs.writeFileSync(inputPath, JSON.stringify(input));

    // Step 2: Run RISC Zero prover (Rust)
    console.log("  ⚙️  Running RISC Zero prover...");
    try {
      execSync(`cd ${this.risc0Dir} && cargo run --release -p gridzero-host -- input.json`, {
        stdio: "pipe",
        timeout: 300000, // 5 min timeout
      });
    } catch (error: any) {
      throw new Error(`RISC Zero proof generation failed: ${error.message}`);
    }

    // Step 3: Read proof artifacts
    const proofHex = fs.readFileSync(
      path.join(this.risc0Dir, "proof.hex"),
      "utf-8"
    );
    const imageIdHex = fs.readFileSync(
      path.join(this.risc0Dir, "image_id.hex"),
      "utf-8"
    );
    const output = JSON.parse(
      fs.readFileSync(path.join(this.risc0Dir, "output.json"), "utf-8")
    );

    console.log(`  📊 Score: ${output.score}, Mined: ${output.total_mined}`);

    // Step 4: Submit to zkVerify
    console.log("  📤 Submitting to zkVerify...");
    const result = await this.zkService.submitLeaderboardProof({
      proof: proofHex,
      publicSignals: JSON.stringify(output),
      vk: imageIdHex,
    });

    console.log(
      `  ${result.success ? "✅" : "❌"} Leaderboard proof ${result.success ? "verified" : "failed"}`
    );

    return {
      score: output.score,
      totalMined: output.total_mined,
      verified: result.success,
    };
  }

  /**
   * Convert Ethereum address to 20-byte array
   */
  private addressToBytes(address: string): number[] {
    const cleaned = address.toLowerCase().replace("0x", "");
    const bytes: number[] = [];
    for (let i = 0; i < 40; i += 2) {
      bytes.push(parseInt(cleaned.substr(i, 2), 16));
    }
    return bytes;
  }
}

export interface MiningRecord {
  grid_x: number;
  grid_y: number;
  ore_type: number;
  is_rare: boolean;
  random_output: number[]; // 32 bytes
  nonce: number;
}
