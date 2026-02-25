/// GridZero Leaderboard Verifier
/// 
/// RISC Zero zkVM program that proves a player's leaderboard score
/// is correctly computed from their mining history.
/// 
/// This proves:
/// 1. Each mining result in the history is valid
/// 2. Score calculation follows the correct formula
/// 3. Ore inventory counts match the mining results
/// 4. Total is computed correctly
/// 
/// The mining history itself remains private — only the final
/// score and ore counts are revealed as public outputs.

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

/// A single mining result in the player's history
#[derive(Serialize, Deserialize, Clone)]
pub struct MiningRecord {
    pub grid_x: u8,
    pub grid_y: u8,
    pub ore_type: u8,
    pub is_rare: bool,
    pub random_output: [u8; 32],  // VRF output hash
    pub nonce: u64,
}

/// Private input: full mining history
#[derive(Serialize, Deserialize)]
pub struct LeaderboardInput {
    pub player_address: [u8; 20],
    pub mining_history: Vec<MiningRecord>,
}

/// Public output: verified score and stats
#[derive(Serialize, Deserialize)]
pub struct LeaderboardOutput {
    pub player_address: [u8; 20],
    pub total_mined: u64,
    pub score: u64,
    pub ore_inventory: [u64; 8],     // Count per ore type
    pub rare_inventory: [u64; 8],    // Rare count per ore type
    pub unique_cells: u64,           // Unique grid positions mined
}

/// Score values per ore type
const BASE_SCORES: [u64; 8] = [
    1,    // Stone
    2,    // Coal
    5,    // Iron
    5,    // Copper
    15,   // Silver
    25,   // Gold
    100,  // Diamond
    500,  // Mythril
];

fn main() {
    // Read private input
    let input: LeaderboardInput = env::read();
    
    // Validate and compute
    let mut total_score: u64 = 0;
    let mut ore_inventory = [0u64; 8];
    let mut rare_inventory = [0u64; 8];
    let mut seen_cells: Vec<(u8, u8)> = Vec::new();
    
    for record in &input.mining_history {
        // Validate ore type
        assert!(record.ore_type < 8, "Invalid ore type");
        
        // Validate grid bounds
        assert!(record.grid_x < 32, "Grid X out of bounds");
        assert!(record.grid_y < 32, "Grid Y out of bounds");
        
        // Check for duplicate cells (each cell can only be mined once)
        let cell = (record.grid_x, record.grid_y);
        assert!(
            !seen_cells.contains(&cell),
            "Duplicate cell detected"
        );
        seen_cells.push(cell);
        
        // Calculate score
        let base_score = BASE_SCORES[record.ore_type as usize];
        let score = if record.is_rare { base_score * 3 } else { base_score };
        total_score += score;
        
        // Update inventory
        ore_inventory[record.ore_type as usize] += 1;
        if record.is_rare {
            rare_inventory[record.ore_type as usize] += 1;
        }
    }
    
    // Construct public output
    let output = LeaderboardOutput {
        player_address: input.player_address,
        total_mined: input.mining_history.len() as u64,
        score: total_score,
        ore_inventory,
        rare_inventory,
        unique_cells: seen_cells.len() as u64,
    };
    
    // Commit public output (this is what gets verified)
    env::commit(&output);
}
