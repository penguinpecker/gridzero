import { GridZeroProver, MiningInput, MiningProof } from "../circuits/prover";
import {
  GridZeroZkService,
  ProofSubmission,
  AttestationReceipt,
} from "./zkverify-service";
import { ethers } from "ethers";
import { EventEmitter } from "events";

// ============================================================
// Types
// ============================================================

export interface MineRequest {
  playerAddress: string;
  gridX: number;
  gridY: number;
}

export interface MineResult {
  success: boolean;
  randomOutput: string;
  oreName: string;
  oreType: number;
  rarity: string;
  isRare: boolean;
  gridX: number;
  gridY: number;
  nonce: number;
  // Settlement info (populated async)
  settlementPending: boolean;
  txHash?: string;
}

export interface PlayerState {
  address: string;
  nonce: number;
  totalMined: number;
  inventory: Map<number, number>; // oreType -> count
  score: number;
}

// ============================================================
// GridZero Game Engine
// ============================================================

/**
 * GridZeroEngine
 *
 * Orchestrates the full mining lifecycle:
 * 1. Player requests mine(x, y)
 * 2. Engine generates VRF proof (Groth16)
 * 3. Optimistic verify → instant result to player
 * 4. Submit proof to zkVerify (single or batch)
 * 5. Wait for aggregation → get attestation receipt
 * 6. Submit attestation to Base contract for settlement
 */
export class GridZeroEngine extends EventEmitter {
  private prover: GridZeroProver;
  private zkService: GridZeroZkService;
  private playerStates: Map<string, PlayerState> = new Map();
  private pendingProofs: ProofSubmission[] = [];
  private batchInterval: NodeJS.Timeout | null = null;
  private secretSeed: string;
  private currentDifficulty: number = 128; // Default 50% rarity chance
  private baseContract: ethers.Contract | null = null;

  // Grid state: track which cells have been mined
  private gridState: Map<string, { oreType: number; minedBy: string }> =
    new Map();

  constructor(
    secretSeed: string,
    zkServiceConfig: {
      seedPhrase: string;
      network: "testnet" | "mainnet";
    }
  ) {
    super();
    this.secretSeed = secretSeed;
    this.prover = new GridZeroProver();
    this.zkService = new GridZeroZkService(zkServiceConfig);
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize the game engine
   * - Connect to zkVerify
   * - Register domains
   * - Register verification keys
   * - Start batch processing
   * - Subscribe to events
   */
  async initialize(): Promise<void> {
    console.log("🎮 Initializing GridZero Engine...");

    // Connect to zkVerify
    await this.zkService.connect();

    // Register domains for each proof type
    const domains = await this.zkService.registerDomains();
    console.log("  📋 Domains registered:", domains);

    // Register VRF verification key
    const vk = this.prover.getVerificationKey();
    await this.zkService.registerVk(vk, "groth16");
    console.log("  🔑 VRF VK registered");

    // Subscribe to aggregation events
    this.zkService.subscribeToAggregations();
    this.zkService.on("aggregation", (data) => {
      this.handleAggregation(data);
    });

    // Start batch processing (every 5 seconds)
    this.startBatchProcessing(5000);

    console.log("✅ GridZero Engine ready");
  }

  // ============================================================
  // Core Mining Flow
  // ============================================================

  /**
   * Process a mining action
   *
   * Flow:
   * 1. Generate VRF proof
   * 2. Optimistic verify (instant result)
   * 3. Queue for batch submission
   * 4. Return result to player immediately
   */
  async mine(request: MineRequest): Promise<MineResult> {
    const { playerAddress, gridX, gridY } = request;

    // Check if cell already mined
    const cellKey = `${gridX},${gridY}`;
    if (this.gridState.has(cellKey)) {
      throw new Error(`Cell (${gridX}, ${gridY}) already mined`);
    }

    // Get or create player state
    const player = this.getOrCreatePlayer(playerAddress);
    player.nonce++;

    // Step 1: Generate proof
    const proofInput: MiningInput = {
      secretSeed: this.secretSeed,
      playerAddress: this.addressToField(playerAddress),
      gridX,
      gridY,
      nonce: player.nonce,
      difficultyThreshold: this.currentDifficulty,
    };

    console.log(
      `⛏️  [${playerAddress.slice(0, 8)}...] Mining at (${gridX}, ${gridY})...`
    );

    const proof = await this.prover.generateProof(proofInput);

    // Step 2: Verify locally first
    const localValid = await this.prover.verifyLocally(proof);
    if (!localValid) {
      throw new Error("Local proof verification failed");
    }

    // Step 3: Format for zkVerify and queue
    const zkProof = this.prover.formatForZkVerify(proof);
    this.pendingProofs.push(zkProof);

    // Step 4: Update game state
    const oreName = GridZeroProver.getOreName(proof.oreType);
    const rarity = GridZeroProver.getOreRarity(proof.oreType);

    this.gridState.set(cellKey, {
      oreType: proof.oreType,
      minedBy: playerAddress,
    });

    player.totalMined++;
    player.inventory.set(
      proof.oreType,
      (player.inventory.get(proof.oreType) || 0) + 1
    );
    player.score += this.calculateScore(proof.oreType, proof.isRare);

    const result: MineResult = {
      success: true,
      randomOutput: proof.randomOutput,
      oreName,
      oreType: proof.oreType,
      rarity,
      isRare: proof.isRare,
      gridX,
      gridY,
      nonce: player.nonce,
      settlementPending: true,
    };

    console.log(
      `  💎 Found: ${oreName} (${rarity})${proof.isRare ? " ⭐ RARE!" : ""}`
    );

    this.emit("mined", result);
    return result;
  }

  // ============================================================
  // Batch Processing
  // ============================================================

  /**
   * Start periodic batch submission of pending proofs
   */
  private startBatchProcessing(intervalMs: number): void {
    this.batchInterval = setInterval(async () => {
      if (this.pendingProofs.length === 0) return;

      const batch = [...this.pendingProofs];
      this.pendingProofs = [];

      console.log(`📦 Processing batch of ${batch.length} proofs...`);

      try {
        if (batch.length === 1) {
          // Single proof - direct submit
          await this.zkService.submitVrfProof(batch[0]);
        } else {
          // Multiple proofs - batch submit
          await this.zkService.batchSubmitVrfProofs(batch);
        }

        console.log(`  ✅ Batch submitted to zkVerify`);
      } catch (error: any) {
        console.error(`  ❌ Batch failed: ${error.message}`);
        // Re-queue failed proofs
        this.pendingProofs.unshift(...batch);
      }
    }, intervalMs);

    console.log(
      `  ⏰ Batch processing started (interval: ${intervalMs}ms)`
    );
  }

  /**
   * Stop batch processing
   */
  stopBatchProcessing(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }

  // ============================================================
  // Settlement (Attestation → Base)
  // ============================================================

  /**
   * Handle aggregation receipt from zkVerify
   * Submits attestation to Base contract
   */
  private async handleAggregation(data: any): Promise<void> {
    console.log(`📬 Aggregation received: ${data.domain} #${data.aggregationId}`);

    // In production, submit the attestation to Base contract here
    // this.submitToBase(data.statementPath);

    this.emit("settlement", {
      domain: data.domain,
      aggregationId: data.aggregationId,
      attestation: data.statementPath,
    });
  }

  /**
   * Submit attestation proof to Base smart contract
   */
  async submitToBase(attestation: AttestationReceipt): Promise<string> {
    if (!this.baseContract) {
      throw new Error("Base contract not connected");
    }

    const tx = await this.baseContract.verifyMiningAttestation(
      attestation.root,
      attestation.proof,
      attestation.numberOfLeaves,
      attestation.leafIndex,
      attestation.leaf,
      attestation.domainId,
      attestation.aggregationId
    );

    const receipt = await tx.wait();
    console.log(`  🏗️  Base settlement tx: ${receipt.transactionHash}`);

    return receipt.transactionHash;
  }

  // ============================================================
  // Difficulty Management (Updated by EZKL model)
  // ============================================================

  /**
   * Update mining difficulty
   * Called when EZKL model produces new difficulty recommendation
   */
  updateDifficulty(newThreshold: number): void {
    if (newThreshold < 1 || newThreshold > 255) {
      throw new Error("Difficulty must be 1-255");
    }
    this.currentDifficulty = newThreshold;
    console.log(`🎯 Difficulty updated: ${newThreshold}`);
    this.emit("difficultyChanged", newThreshold);
  }

  getDifficulty(): number {
    return this.currentDifficulty;
  }

  // ============================================================
  // Player Management
  // ============================================================

  private getOrCreatePlayer(address: string): PlayerState {
    if (!this.playerStates.has(address)) {
      this.playerStates.set(address, {
        address,
        nonce: 0,
        totalMined: 0,
        inventory: new Map(),
        score: 0,
      });
    }
    return this.playerStates.get(address)!;
  }

  getPlayerState(address: string): PlayerState | undefined {
    return this.playerStates.get(address);
  }

  getLeaderboard(): PlayerState[] {
    return Array.from(this.playerStates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }

  // ============================================================
  // Grid State
  // ============================================================

  getGridState(): Map<string, { oreType: number; minedBy: string }> {
    return this.gridState;
  }

  isCellMined(x: number, y: number): boolean {
    return this.gridState.has(`${x},${y}`);
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Convert Ethereum address to field element for Circom
   */
  private addressToField(address: string): string {
    // Take the last 20 bytes and convert to BigInt
    const cleaned = address.toLowerCase().replace("0x", "");
    return BigInt("0x" + cleaned).toString();
  }

  /**
   * Calculate score for a mining result
   */
  private calculateScore(oreType: number, isRare: boolean): number {
    const baseScores: Record<number, number> = {
      0: 1, // Stone
      1: 2, // Coal
      2: 5, // Iron
      3: 5, // Copper
      4: 15, // Silver
      5: 25, // Gold
      6: 100, // Diamond
      7: 500, // Mythril
    };
    const base = baseScores[oreType] || 1;
    return isRare ? base * 3 : base;
  }

  /**
   * Shutdown engine gracefully
   */
  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down GridZero Engine...");

    // Flush pending proofs
    if (this.pendingProofs.length > 0) {
      console.log(
        `  📦 Flushing ${this.pendingProofs.length} pending proofs...`
      );
      await this.zkService.batchSubmitVrfProofs(this.pendingProofs);
    }

    this.stopBatchProcessing();
    await this.zkService.disconnect();
    console.log("✅ Engine shutdown complete");
  }
}
