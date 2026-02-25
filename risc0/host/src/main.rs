/// GridZero Leaderboard Proof Host
/// 
/// Generates RISC Zero proofs for leaderboard score verification
/// and submits them to zkVerify for on-chain attestation.

use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts};
use serde::{Deserialize, Serialize};
use std::fs;

// Import the guest program's image ID
use gridzero_methods::GRIDZERO_GUEST_ID;

/// A single mining result
#[derive(Serialize, Deserialize, Clone)]
pub struct MiningRecord {
    pub grid_x: u8,
    pub grid_y: u8,
    pub ore_type: u8,
    pub is_rare: bool,
    pub random_output: [u8; 32],
    pub nonce: u64,
}

/// Input for the guest program
#[derive(Serialize, Deserialize)]
pub struct LeaderboardInput {
    pub player_address: [u8; 20],
    pub mining_history: Vec<MiningRecord>,
}

/// Output from the guest program
#[derive(Serialize, Deserialize, Debug)]
pub struct LeaderboardOutput {
    pub player_address: [u8; 20],
    pub total_mined: u64,
    pub score: u64,
    pub ore_inventory: [u64; 8],
    pub rare_inventory: [u64; 8],
    pub unique_cells: u64,
}

fn main() {
    // Load mining history from file (in production, from database)
    let input_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "input.json".to_string());
    
    let input_data = fs::read_to_string(&input_path)
        .expect("Failed to read input file");
    let input: LeaderboardInput = serde_json::from_str(&input_data)
        .expect("Failed to parse input");
    
    println!("🎮 GridZero Leaderboard Proof Generator");
    println!("  Player: 0x{}", hex::encode(&input.player_address));
    println!("  Mining records: {}", input.mining_history.len());
    
    // Build executor environment with input
    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();
    
    // Generate proof
    println!("\n⚙️  Generating RISC Zero proof...");
    let prover = default_prover();
    let receipt = prover
        .prove_with_opts(env, GRIDZERO_GUEST_ID, &ProverOpts::succinct())
        .expect("Proof generation failed");
    
    // Extract public output
    let output: LeaderboardOutput = receipt.journal.decode().unwrap();
    
    println!("\n📊 Verified Leaderboard Stats:");
    println!("  Total mined: {}", output.total_mined);
    println!("  Score: {}", output.score);
    println!("  Unique cells: {}", output.unique_cells);
    println!("  Ore inventory: {:?}", output.ore_inventory);
    println!("  Rare inventory: {:?}", output.rare_inventory);
    
    // Serialize proof for zkVerify submission
    let proof_bytes = bincode::serialize(&receipt).unwrap();
    let proof_hex = hex::encode(&proof_bytes);
    
    // Save proof artifacts
    fs::write("proof.bin", &proof_bytes).unwrap();
    fs::write("proof.hex", &proof_hex).unwrap();
    fs::write("output.json", serde_json::to_string_pretty(&output).unwrap()).unwrap();
    
    // Save image ID (verification key for zkVerify)
    let image_id_hex = hex::encode(GRIDZERO_GUEST_ID.as_bytes());
    fs::write("image_id.hex", &image_id_hex).unwrap();
    
    println!("\n✅ Proof generated!");
    println!("  Proof: proof.bin ({} bytes)", proof_bytes.len());
    println!("  Image ID: {}", image_id_hex);
    println!("\nNext: Submit to zkVerify using zkverifyjs");
}
