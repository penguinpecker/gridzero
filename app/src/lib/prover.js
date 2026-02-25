import * as snarkjs from "snarkjs";
import path from "path";
import { readFileSync } from "fs";

const CIRCUIT_DIR = path.join(process.cwd(), "..", "circuits", "build");
const WASM_PATH = path.join(CIRCUIT_DIR, "gridzero_vrf_js", "gridzero_vrf.wasm");
const ZKEY_PATH = path.join(CIRCUIT_DIR, "gridzero_vrf_final.zkey");
const VKEY_PATH = path.join(CIRCUIT_DIR, "verification_key.json");

let vkeyCache = null;
function getVkey() {
  if (!vkeyCache) vkeyCache = JSON.parse(readFileSync(VKEY_PATH, "utf-8"));
  return vkeyCache;
}

export async function generateMiningProof(gridX, gridY, playerAddress, nonce, secretSeed = "42069", difficulty = 128) {
  const playerField = BigInt(playerAddress).toString();

  const input = {
    secret_seed: secretSeed,
    player_address: playerField,
    grid_x: gridX.toString(),
    grid_y: gridY.toString(),
    nonce: nonce.toString(),
    difficulty_threshold: difficulty.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);

  const vkey = getVkey();
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);

  // Public signals order: random_output, ore_type, is_rare, player_address, grid_x, grid_y, nonce, difficulty_threshold
  const randomOutput = publicSignals[0];
  const oreType = parseInt(publicSignals[1]);
  const isRare = publicSignals[2] === "1";

  return {
    proof,
    publicSignals,
    verified,
    parsed: { randomOutput, oreType, isRare, gridX, gridY },
  };
}

export function getVerificationKey() {
  return getVkey();
}
