"""
GridZero Adaptive Difficulty Model

A simple neural network that takes game state metrics and outputs
an optimal difficulty threshold. The model is exported to ONNX format
and proven with EZKL, so players can verify the difficulty adjustment
is computed fairly by the model (not manipulated by the server).

Inputs (5 features):
  - total_players: Number of active players
  - avg_score: Average player score
  - rare_rate: Current rare ore discovery rate (0-1)
  - total_mined: Total cells mined across all players
  - time_factor: Hours since game start (normalized)

Output:
  - difficulty_threshold: Optimal threshold (1-255)
    Higher = more rare ores, Lower = fewer rare ores
"""

import torch
import torch.nn as nn
import numpy as np
import json
import os


class DifficultyModel(nn.Module):
    """
    Simple feedforward network for difficulty prediction.
    Kept small intentionally — EZKL proof generation time scales
    with model complexity. This ~200 parameter model should prove in <30s.
    """
    
    def __init__(self):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(5, 16),
            nn.ReLU(),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
            nn.Sigmoid()  # Output 0-1, scaled to 1-255
        )
    
    def forward(self, x):
        raw = self.network(x)
        # Scale to difficulty range: 1-255
        # Sigmoid output (0-1) → (1, 255)
        return raw * 254 + 1


def generate_training_data(n_samples=10000):
    """
    Generate synthetic training data based on game design principles:
    
    - When few players: higher difficulty (more rare ores to attract players)
    - When many players: moderate difficulty (balance economy)
    - When rare_rate too high: lower difficulty (ores becoming too common)
    - When rare_rate too low: higher difficulty (ores too scarce)
    - Time decay: difficulty gradually increases over time
    """
    np.random.seed(42)
    
    total_players = np.random.uniform(1, 1000, n_samples)
    avg_score = np.random.uniform(0, 10000, n_samples)
    rare_rate = np.random.uniform(0, 1, n_samples)
    total_mined = np.random.uniform(0, 32*32, n_samples)  # Max 1024 cells
    time_factor = np.random.uniform(0, 1, n_samples)
    
    # Target difficulty formula (our "ground truth" game design)
    target = np.zeros(n_samples)
    
    for i in range(n_samples):
        base = 128  # Default 50%
        
        # Player count adjustment
        if total_players[i] < 50:
            base += 40  # More rare ores to attract players
        elif total_players[i] > 500:
            base -= 20  # Tighten economy
        
        # Rare rate feedback loop
        if rare_rate[i] > 0.6:
            base -= 50  # Too many rares, reduce
        elif rare_rate[i] < 0.2:
            base += 50  # Too few rares, increase
        
        # Grid saturation
        saturation = total_mined[i] / 1024
        if saturation > 0.7:
            base += 30  # Grid almost full, make remaining cells valuable
        
        # Time decay
        base -= time_factor[i] * 20  # Gradually harder over time
        
        # Noise for realism
        base += np.random.normal(0, 10)
        
        target[i] = np.clip(base, 1, 255) / 255.0  # Normalize to 0-1
    
    # Normalize inputs
    X = np.column_stack([
        total_players / 1000,
        avg_score / 10000,
        rare_rate,
        total_mined / 1024,
        time_factor
    ]).astype(np.float32)
    
    y = target.astype(np.float32).reshape(-1, 1)
    
    return X, y


def train_model():
    """Train the difficulty model"""
    print("🧠 Training GridZero Difficulty Model...")
    
    X, y = generate_training_data()
    
    X_tensor = torch.FloatTensor(X)
    y_tensor = torch.FloatTensor(y)
    
    model = DifficultyModel()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()
    
    # Training loop
    for epoch in range(500):
        optimizer.zero_grad()
        
        # Forward pass (use raw sigmoid output for training)
        raw_output = model.network(X_tensor)
        loss = criterion(raw_output, y_tensor)
        
        loss.backward()
        optimizer.step()
        
        if (epoch + 1) % 100 == 0:
            print(f"  Epoch {epoch+1}/500, Loss: {loss.item():.6f}")
    
    print("✅ Training complete")
    return model


def export_to_onnx(model, output_dir="./build"):
    """Export model to ONNX format for EZKL"""
    os.makedirs(output_dir, exist_ok=True)
    
    # Dummy input for tracing
    dummy_input = torch.randn(1, 5)
    
    onnx_path = os.path.join(output_dir, "difficulty_model.onnx")
    
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        input_names=["game_state"],
        output_names=["difficulty"],
        dynamic_axes={
            "game_state": {0: "batch_size"},
            "difficulty": {0: "batch_size"}
        },
        opset_version=11
    )
    
    print(f"✅ ONNX model exported: {onnx_path}")
    return onnx_path


def generate_sample_input(output_dir="./build"):
    """Generate a sample input for EZKL calibration"""
    os.makedirs(output_dir, exist_ok=True)
    
    # Sample game state
    sample = {
        "input_data": [[
            0.15,   # 150 players (normalized)
            0.35,   # avg score 3500
            0.45,   # 45% rare rate
            0.30,   # 30% grid mined
            0.25    # 25% time elapsed
        ]]
    }
    
    input_path = os.path.join(output_dir, "input.json")
    with open(input_path, "w") as f:
        json.dump(sample, f, indent=2)
    
    print(f"✅ Sample input: {input_path}")
    return input_path


def main():
    print("🎮 GridZero EZKL Difficulty Model")
    print("=" * 40)
    
    # Train
    model = train_model()
    
    # Test inference
    test_input = torch.FloatTensor([[0.15, 0.35, 0.45, 0.30, 0.25]])
    with torch.no_grad():
        difficulty = model(test_input)
    print(f"\n🎯 Test prediction: difficulty = {difficulty.item():.1f} / 255")
    
    # Export
    print()
    export_to_onnx(model)
    generate_sample_input()
    
    # Save model weights
    torch.save(model.state_dict(), "./build/difficulty_model.pt")
    print("✅ Model weights saved: ./build/difficulty_model.pt")
    
    print("\n" + "=" * 40)
    print("Next steps:")
    print("  1. Run: ezkl gen-settings -M build/difficulty_model.onnx")
    print("  2. Run: ezkl calibrate-settings ...")
    print("  3. Run: ezkl compile-circuit ...")
    print("  4. Run: ezkl setup ...")
    print("  5. Run: ezkl prove ...")
    print("  6. Submit proof to zkVerify")


if __name__ == "__main__":
    main()
