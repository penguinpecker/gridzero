import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { GridZeroZkService } from "../services/zkverify-service";

/**
 * GridZero Difficulty Proof Service
 *
 * Uses EZKL to prove that the difficulty adjustment is computed
 * by a legitimate ML model, not manually manipulated by the server.
 *
 * Flow:
 * 1. Collect game state metrics
 * 2. Run model inference + EZKL proof generation
 * 3. Submit proof to zkVerify
 * 4. Update game difficulty on-chain via attestation
 */

export interface GameStateMetrics {
  totalPlayers: number;
  avgScore: number;
  rareRate: number;      // 0-1
  totalMined: number;
  timeFactor: number;    // 0-1, normalized hours since start
}

export class DifficultyProofService {
  private zkService: GridZeroZkService;
  private ezklDir: string;
  private buildDir: string;

  constructor(zkService: GridZeroZkService) {
    this.zkService = zkService;
    this.ezklDir = path.join(__dirname, "../ezkl");
    this.buildDir = path.join(this.ezklDir, "build");
  }

  /**
   * Generate a new difficulty with EZKL proof
   */
  async computeAndProve(metrics: GameStateMetrics): Promise<{
    difficulty: number;
    verified: boolean;
  }> {
    console.log("🧠 Computing new difficulty with EZKL proof...");

    // Step 1: Normalize inputs to match model expectations
    const normalizedInput = {
      input_data: [[
        metrics.totalPlayers / 1000,
        metrics.avgScore / 10000,
        metrics.rareRate,
        metrics.totalMined / 1024,
        metrics.timeFactor
      ]]
    };

    // Write input for EZKL
    const inputPath = path.join(this.buildDir, "live_input.json");
    fs.writeFileSync(inputPath, JSON.stringify(normalizedInput, null, 2));

    // Step 2: Generate witness
    console.log("  👁️  Generating witness...");
    execSync(`cd ${this.ezklDir} && ezkl gen-witness \
      -D ${inputPath} \
      --compiled-circuit ${this.buildDir}/difficulty_circuit.ezkl \
      --output ${this.buildDir}/live_witness.json \
      --settings-path ${this.buildDir}/settings.json`, {
      stdio: "pipe",
    });

    // Step 3: Generate proof
    console.log("  🔒 Generating EZKL proof...");
    execSync(`cd ${this.ezklDir} && ezkl prove \
      --compiled-circuit ${this.buildDir}/difficulty_circuit.ezkl \
      --pk-path ${this.buildDir}/pk.key \
      --witness ${this.buildDir}/live_witness.json \
      --proof-path ${this.buildDir}/live_proof.json \
      --settings-path ${this.buildDir}/settings.json`, {
      stdio: "pipe",
      timeout: 120000, // 2 min timeout
    });

    // Step 4: Read proof and extract output
    const proofData = JSON.parse(
      fs.readFileSync(path.join(this.buildDir, "live_proof.json"), "utf-8")
    );

    // Extract difficulty from proof output
    // EZKL encodes the output in the proof's public inputs
    const rawDifficulty = this.extractDifficulty(proofData);
    const difficulty = Math.round(Math.max(1, Math.min(255, rawDifficulty)));

    console.log(`  🎯 Model output: difficulty = ${difficulty}`);

    // Step 5: Read VK and prepare for zkVerify
    const vkHex = fs.readFileSync(
      path.join(this.buildDir, "vk.hex"),
      "utf-8"
    );

    // Step 6: Submit to zkVerify
    console.log("  📤 Submitting to zkVerify...");
    const result = await this.zkService.submitDifficultyProof({
      proof: JSON.stringify(proofData),
      publicSignals: JSON.stringify(normalizedInput),
      vk: vkHex,
    });

    console.log(
      `  ${result.success ? "✅" : "❌"} Difficulty proof ${result.success ? "verified" : "failed"}`
    );

    return {
      difficulty,
      verified: result.success,
    };
  }

  /**
   * Extract difficulty value from EZKL proof output
   */
  private extractDifficulty(proofData: any): number {
    // EZKL encodes outputs as scaled fixed-point integers
    // The exact extraction depends on the EZKL settings (scale factor)
    try {
      if (proofData.pretty_public_inputs) {
        const outputs = proofData.pretty_public_inputs.outputs;
        if (outputs && outputs[0] && outputs[0][0] !== undefined) {
          return outputs[0][0];
        }
      }

      // Fallback: parse from instances
      if (proofData.instances && proofData.instances[0]) {
        const lastInstance = proofData.instances[0].slice(-1)[0];
        // EZKL uses fixed-point arithmetic, typically scale=7 (2^7 = 128)
        const scaleFactor = 128;
        return parseInt(lastInstance, 16) / scaleFactor;
      }
    } catch (e) {
      console.warn("  ⚠️  Could not extract difficulty from proof, using default");
    }

    return 128; // Default
  }

  /**
   * Schedule periodic difficulty updates
   */
  startPeriodicUpdates(
    getMetrics: () => GameStateMetrics,
    intervalMs: number = 300000 // 5 minutes default
  ): NodeJS.Timeout {
    console.log(`⏰ Scheduling difficulty updates every ${intervalMs / 1000}s`);

    return setInterval(async () => {
      try {
        const metrics = getMetrics();
        const { difficulty, verified } = await this.computeAndProve(metrics);

        if (verified) {
          this.emit("difficultyUpdated", difficulty);
        }
      } catch (error: any) {
        console.error(`❌ Difficulty update failed: ${error.message}`);
      }
    }, intervalMs);
  }

  // Simple event emitter mixin
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach((cb) => cb(...args));
  }
}
