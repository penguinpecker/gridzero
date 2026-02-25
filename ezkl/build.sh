#!/bin/bash
set -e

echo "🧠 GridZero EZKL Difficulty Model Build"
echo "========================================"

BUILD_DIR="./build"
MODEL="$BUILD_DIR/difficulty_model.onnx"
INPUT="$BUILD_DIR/input.json"

# Step 0: Train and export model
echo ""
echo "📦 Training model and exporting ONNX..."
python3 model.py

# Step 1: Generate settings
echo ""
echo "⚙️  Generating EZKL settings..."
ezkl gen-settings \
    -M $MODEL \
    --settings-path $BUILD_DIR/settings.json

# Step 2: Calibrate settings
echo ""
echo "📐 Calibrating settings..."
ezkl calibrate-settings \
    -M $MODEL \
    -D $INPUT \
    --settings-path $BUILD_DIR/settings.json \
    --target resources

# Step 3: Compile circuit
echo ""
echo "🔧 Compiling ZK circuit..."
ezkl compile-circuit \
    -M $MODEL \
    --compiled-circuit $BUILD_DIR/difficulty_circuit.ezkl \
    --settings-path $BUILD_DIR/settings.json

# Step 4: Setup (generate proving and verification keys)
echo ""
echo "🔐 Running setup..."
ezkl setup \
    --compiled-circuit $BUILD_DIR/difficulty_circuit.ezkl \
    --pk-path $BUILD_DIR/pk.key \
    --vk-path $BUILD_DIR/vk.key \
    --settings-path $BUILD_DIR/settings.json

# Step 5: Generate witness
echo ""
echo "👁️  Generating witness..."
ezkl gen-witness \
    -D $INPUT \
    --compiled-circuit $BUILD_DIR/difficulty_circuit.ezkl \
    --output $BUILD_DIR/witness.json \
    --settings-path $BUILD_DIR/settings.json

# Step 6: Generate proof
echo ""
echo "🔒 Generating EZKL proof..."
ezkl prove \
    --compiled-circuit $BUILD_DIR/difficulty_circuit.ezkl \
    --pk-path $BUILD_DIR/pk.key \
    --witness $BUILD_DIR/witness.json \
    --proof-path $BUILD_DIR/proof.json \
    --settings-path $BUILD_DIR/settings.json

# Step 7: Verify locally
echo ""
echo "✅ Verifying proof locally..."
ezkl verify \
    --proof-path $BUILD_DIR/proof.json \
    --vk-path $BUILD_DIR/vk.key \
    --settings-path $BUILD_DIR/settings.json

# Step 8: Export for zkVerify
echo ""
echo "📤 Preparing artifacts for zkVerify..."

# Convert proof to hex format
python3 -c "
import json

with open('$BUILD_DIR/proof.json', 'r') as f:
    proof = json.load(f)

with open('$BUILD_DIR/vk.key', 'rb') as f:
    vk_bytes = f.read()

# Write hex artifacts
with open('$BUILD_DIR/proof.hex', 'w') as f:
    f.write(proof.get('hex_proof', json.dumps(proof)))

with open('$BUILD_DIR/vk.hex', 'w') as f:
    f.write(vk_bytes.hex())

print('Artifacts ready for zkVerify submission')
"

echo ""
echo "========================================"
echo "🎉 EZKL build complete!"
echo ""
echo "Artifacts:"
echo "  ONNX model:        $BUILD_DIR/difficulty_model.onnx"
echo "  Compiled circuit:   $BUILD_DIR/difficulty_circuit.ezkl"
echo "  Proving key:        $BUILD_DIR/pk.key"
echo "  Verification key:   $BUILD_DIR/vk.key"
echo "  Proof:              $BUILD_DIR/proof.json"
echo "  Proof (hex):        $BUILD_DIR/proof.hex"
echo "  VK (hex):           $BUILD_DIR/vk.hex"
