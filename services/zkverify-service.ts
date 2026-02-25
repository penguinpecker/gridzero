import {
  zkVerifySession,
  ZkVerifyEvents,
  Library,
  CurveType,
  Risc0Version,
  AggregateSecurityRules,
  Destination,
} from "zkverifyjs";
import { EventEmitter } from "events";

// ============================================================
// Types
// ============================================================

export interface GridZeroConfig {
  seedPhrase: string;
  network: "testnet" | "mainnet";
  domainId?: number;
  baseDomainId?: number; // Domain targeting Base attestation
}

export interface ProofSubmission {
  proof: string;
  publicSignals: string;
  vk: string;
}

export interface VerificationResult {
  success: boolean;
  blockHash?: string;
  txHash?: string;
  statement?: string;
  aggregationId?: number;
  error?: string;
}

export interface AttestationReceipt {
  root: string;
  proof: string[];
  numberOfLeaves: number;
  leafIndex: number;
  leaf: string;
  domainId: number;
  aggregationId: number;
}

// ============================================================
// GridZero zkVerify Service
// ============================================================

/**
 * GridZeroZkService
 *
 * Manages all zkVerify interactions for GridZero:
 * - Session management
 * - Domain registration & configuration
 * - VK registration (gas optimization)
 * - Single proof verification (Groth16, RISC0, EZKL)
 * - Batch verification (multi-player mining)
 * - Optimistic verification (instant UX)
 * - Aggregation receipts & attestation paths
 * - Event subscription system
 */
export class GridZeroZkService extends EventEmitter {
  private session: any = null;
  private config: GridZeroConfig;
  private registeredVkHashes: Map<string, string> = new Map();

  // Domain IDs for different proof types
  private vrfDomainId: number | null = null;
  private leaderboardDomainId: number | null = null;
  private difficultyDomainId: number | null = null;

  constructor(config: GridZeroConfig) {
    super();
    this.config = config;
  }

  // ============================================================
  // Session Management
  // ============================================================

  /**
   * Start a zkVerify session
   */
  async connect(): Promise<void> {
    console.log(`🔗 Connecting to zkVerify ${this.config.network}...`);

    if (this.config.network === "mainnet") {
      this.session = await zkVerifySession
        .start()
        .zkVerify()
        .withAccount(this.config.seedPhrase);
    } else {
      this.session = await zkVerifySession
        .start()
        .Volta()
        .withAccount(this.config.seedPhrase);
    }

    console.log("✅ Connected to zkVerify");
  }

  /**
   * Disconnect session
   */
  async disconnect(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = null;
      console.log("🔌 Disconnected from zkVerify");
    }
  }

  // ============================================================
  // Domain Management (Feature: registerDomain)
  // ============================================================

  /**
   * Register GridZero domains on zkVerify
   *
   * Creates separate domains for:
   * - VRF proofs (mining randomness) — high frequency
   * - Leaderboard proofs (RISC0) — periodic
   * - Difficulty proofs (EZKL) — periodic
   */
  async registerDomains(): Promise<{
    vrf: number;
    leaderboard: number;
    difficulty: number;
  }> {
    console.log("📋 Registering GridZero domains...");

    // VRF Domain: aggregation size 16 (power of 2), queue 8
    // Higher aggregation = cheaper per-proof cost, but more latency
    const vrfResult = await this.session
      .registerDomain(16, 8, {
        destination: Destination.None, // We'll use Base attestation domain
        aggregateRules: AggregateSecurityRules.Untrusted,
      })
      .transactionResult;

    this.vrfDomainId = vrfResult.domainId;
    console.log(`  ✅ VRF Domain: ${this.vrfDomainId}`);

    // Leaderboard Domain: smaller aggregation (fewer proofs)
    const lbResult = await this.session
      .registerDomain(4, 4, {
        destination: Destination.None,
        aggregateRules: AggregateSecurityRules.Untrusted,
      })
      .transactionResult;

    this.leaderboardDomainId = lbResult.domainId;
    console.log(`  ✅ Leaderboard Domain: ${this.leaderboardDomainId}`);

    // Difficulty Domain: smallest (infrequent proofs)
    const diffResult = await this.session
      .registerDomain(2, 2, {
        destination: Destination.None,
        aggregateRules: AggregateSecurityRules.Untrusted,
      })
      .transactionResult;

    this.difficultyDomainId = diffResult.domainId;
    console.log(`  ✅ Difficulty Domain: ${this.difficultyDomainId}`);

    return {
      vrf: this.vrfDomainId!,
      leaderboard: this.leaderboardDomainId!,
      difficulty: this.difficultyDomainId!,
    };
  }

  // ============================================================
  // VK Registration (Feature: registerVk / withRegisteredVk)
  // ============================================================

  /**
   * Register a verification key on zkVerify
   * After registration, use the hash instead of full VK to save gas
   */
  async registerVk(
    vk: any,
    proofType: "groth16" | "risc0" | "ezkl"
  ): Promise<string> {
    console.log(`🔑 Registering ${proofType} verification key...`);

    let result;

    switch (proofType) {
      case "groth16":
        result = await this.session
          .registerVerificationKey()
          .groth16({ library: Library.snarkjs, curve: CurveType.bn128 })
          .execute(vk);
        break;

      case "risc0":
        result = await this.session
          .registerVerificationKey()
          .risc0({ version: Risc0Version.V2_1 })
          .execute(vk);
        break;

      case "ezkl":
        result = await this.session
          .registerVerificationKey()
          .ezkl()
          .execute(vk);
        break;
    }

    const vkHash = result.hash;
    this.registeredVkHashes.set(proofType, vkHash);
    console.log(`  ✅ VK registered: ${vkHash}`);

    return vkHash;
  }

  // ============================================================
  // Single Proof Verification (Feature: verify)
  // ============================================================

  /**
   * Submit a single Groth16 VRF proof
   */
  async submitVrfProof(
    proofData: ProofSubmission
  ): Promise<VerificationResult> {
    const vkHash = this.registeredVkHashes.get("groth16");

    const verifier = this.session
      .verify()
      .groth16({ library: Library.snarkjs, curve: CurveType.bn128 });

    // Use registered VK if available
    if (vkHash) {
      verifier.withRegisteredVk();
    }

    const { events, transactionResult } = await verifier.execute({
      proofData: {
        proof: proofData.proof,
        publicSignals: proofData.publicSignals,
        vk: vkHash || proofData.vk,
      },
      domainId: this.vrfDomainId || undefined,
    });

    // Listen for events
    events.on(ZkVerifyEvents.IncludedInBlock, (data: any) => {
      this.emit("proofIncluded", data);
    });

    events.on(ZkVerifyEvents.Finalized, (data: any) => {
      this.emit("proofFinalized", data);
    });

    events.on(ZkVerifyEvents.ErrorEvent, (data: any) => {
      this.emit("proofError", data);
    });

    try {
      const result = await transactionResult;
      return {
        success: true,
        blockHash: result.blockHash,
        txHash: result.txHash,
        statement: result.statement,
        aggregationId: result.aggregationId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Submit a RISC Zero leaderboard proof
   */
  async submitLeaderboardProof(
    proofData: ProofSubmission
  ): Promise<VerificationResult> {
    const vkHash = this.registeredVkHashes.get("risc0");

    const verifier = this.session
      .verify()
      .risc0({ version: Risc0Version.V2_1 });

    if (vkHash) {
      verifier.withRegisteredVk();
    }

    const { transactionResult } = await verifier.execute({
      proofData: {
        proof: proofData.proof,
        publicSignals: proofData.publicSignals,
        vk: vkHash || proofData.vk,
      },
      domainId: this.leaderboardDomainId || undefined,
    });

    try {
      const result = await transactionResult;
      return { success: true, statement: result.statement };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Submit an EZKL difficulty model proof
   */
  async submitDifficultyProof(
    proofData: ProofSubmission
  ): Promise<VerificationResult> {
    const vkHash = this.registeredVkHashes.get("ezkl");

    const verifier = this.session.verify().ezkl();

    if (vkHash) {
      verifier.withRegisteredVk();
    }

    const { transactionResult } = await verifier.execute({
      proofData: {
        proof: proofData.proof,
        publicSignals: proofData.publicSignals,
        vk: vkHash || proofData.vk,
      },
      domainId: this.difficultyDomainId || undefined,
    });

    try {
      const result = await transactionResult;
      return { success: true, statement: result.statement };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Batch Verification (Feature: batchVerify)
  // ============================================================

  /**
   * Submit multiple VRF proofs in a single batch
   * Used when multiple players mine in the same block window
   */
  async batchSubmitVrfProofs(
    proofs: ProofSubmission[]
  ): Promise<VerificationResult> {
    console.log(`📦 Batch submitting ${proofs.length} VRF proofs...`);

    const vkHash = this.registeredVkHashes.get("groth16");

    const batchData = proofs.map((p) => ({
      proofData: {
        proof: p.proof,
        publicSignals: p.publicSignals,
        vk: vkHash || p.vk,
      },
      domainId: this.vrfDomainId || 0,
    }));

    const batchVerifier = this.session
      .batchVerify()
      .groth16({ library: Library.snarkjs, curve: CurveType.bn128 });

    if (vkHash) {
      batchVerifier.withRegisteredVk();
    }

    const { events, transactionResult } =
      await batchVerifier.execute(batchData);

    events.on(ZkVerifyEvents.IncludedInBlock, (data: any) => {
      this.emit("batchIncluded", { count: proofs.length, ...data });
    });

    try {
      const result = await transactionResult;
      console.log(`  ✅ Batch verified: ${proofs.length} proofs`);
      return { success: true, blockHash: result.blockHash };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Optimistic Verification (Feature: optimisticVerify)
  // ============================================================

  /**
   * Optimistically verify a proof (instant response, no on-chain settlement)
   * Used for instant UX - player sees result immediately
   *
   * WARNING: Requires custom node with unsafe RPC flags enabled
   */
  async optimisticVerifyVrf(
    proofData: ProofSubmission
  ): Promise<{ success: boolean; message: string }> {
    const vkHash = this.registeredVkHashes.get("groth16");

    const verifier = this.session
      .optimisticVerify()
      .groth16({ library: Library.snarkjs, curve: CurveType.bn128 });

    if (vkHash) {
      verifier.withRegisteredVk();
    }

    const result = await verifier.execute({
      proofData: {
        proof: proofData.proof,
        publicSignals: proofData.publicSignals,
        vk: vkHash || proofData.vk,
      },
      domainId: this.vrfDomainId || undefined,
    });

    return {
      success: result.success,
      message: result.message,
    };
  }

  // ============================================================
  // Aggregation & Attestation (Feature: waitForAggregationReceipt)
  // ============================================================

  /**
   * Wait for an aggregation receipt after proof submission
   * Returns the Merkle path needed for on-chain verification on Base
   */
  async waitForAttestation(
    domainId: number,
    aggregationId: number
  ): Promise<AttestationReceipt> {
    console.log(
      `⏳ Waiting for aggregation receipt (domain: ${domainId}, agg: ${aggregationId})...`
    );

    const receipt = await this.session.waitForAggregationReceipt(
      domainId,
      aggregationId
    );

    console.log(`  ✅ Aggregation receipt received`);
    console.log(`     Root: ${receipt.root}`);
    console.log(`     Leaf index: ${receipt.leafIndex}`);

    return receipt;
  }

  /**
   * Get the Merkle path for a specific proof within an aggregation
   */
  async getStatementPath(
    blockHash: string,
    domainId: number,
    aggregationId: number,
    statement: string
  ): Promise<any> {
    return await this.session.getAggregateStatementPath(
      blockHash,
      domainId,
      aggregationId,
      statement
    );
  }

  // ============================================================
  // Event Subscription (Feature: subscribe)
  // ============================================================

  /**
   * Subscribe to aggregation events for all GridZero domains
   * Emits events when proofs are aggregated and ready for Base attestation
   */
  subscribeToAggregations(): void {
    const domains = [
      { id: this.vrfDomainId, name: "VRF" },
      { id: this.leaderboardDomainId, name: "Leaderboard" },
      { id: this.difficultyDomainId, name: "Difficulty" },
    ];

    for (const domain of domains) {
      if (domain.id === null) continue;

      this.session.subscribe([
        {
          event: ZkVerifyEvents.NewAggregationReceipt,
          callback: async (eventData: any) => {
            console.log(
              `📬 New ${domain.name} aggregation: #${eventData.data.aggregationId}`
            );

            const statementPath = await this.session.getAggregateStatementPath(
              eventData.blockHash,
              parseInt(eventData.data.domainId),
              parseInt(eventData.data.aggregationId),
              eventData.data.statement
            );

            this.emit("aggregation", {
              domain: domain.name,
              domainId: domain.id,
              aggregationId: eventData.data.aggregationId,
              statementPath,
            });
          },
          options: { domainId: domain.id },
        },
      ]);
    }

    console.log("👂 Subscribed to aggregation events");
  }

  // ============================================================
  // Getters
  // ============================================================

  getDomainIds() {
    return {
      vrf: this.vrfDomainId,
      leaderboard: this.leaderboardDomainId,
      difficulty: this.difficultyDomainId,
    };
  }

  getRegisteredVkHashes() {
    return Object.fromEntries(this.registeredVkHashes);
  }
}
