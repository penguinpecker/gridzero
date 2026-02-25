import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { generateMiningProof, getVerificationKey } from "@/lib/prover";
import { submitProofQuick } from "@/lib/zkverify-client";
import { GRIDZERO_ADDR, publicClient, SECRET_SEED, DIFFICULTY } from "@/lib/chain";
import { GRID_ABI } from "@/lib/abi";

function getOwnerWallet() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set");
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  return createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });
}

// Simple nonce tracker (per player, in-memory)
const nonces = {};
function getNextNonce(player) {
  if (!nonces[player]) nonces[player] = 0;
  nonces[player]++;
  return nonces[player];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const startTime = Date.now();
  const stages = [];

  try {
    const { gridX, gridY, player } = req.body;

    if (gridX < 0 || gridX >= 32 || gridY < 0 || gridY >= 32) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }
    if (!player || !player.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid player address" });
    }

    const alreadyMined = await publicClient.readContract({
      address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "isMined", args: [gridX, gridY],
    });
    if (alreadyMined) return res.status(409).json({ error: "Cell already mined" });

    const nonce = getNextNonce(player);

    // Stage 1: Generate Groth16 Proof
    const proofStart = Date.now();
    const proofResult = await generateMiningProof(gridX, gridY, player, nonce, SECRET_SEED, DIFFICULTY);
    stages.push({ id: "generate", label: "GROTH16 PROOF", ms: Date.now() - proofStart, status: "done" });

    // Stage 2: Local Verify
    const verifyStart = Date.now();
    if (!proofResult.verified) return res.status(500).json({ error: "Proof verification failed" });
    stages.push({ id: "verify", label: "LOCAL VERIFY", ms: Date.now() - verifyStart, status: "done" });

    // Stage 3: Submit to zkVerify
    const submitStart = Date.now();
    let zkResult = null;
    try {
      zkResult = await submitProofQuick(proofResult.proof, proofResult.publicSignals, getVerificationKey());
      stages.push({ id: "submit", label: "ZKVERIFY SUBMIT", ms: Date.now() - submitStart, status: "done", txHash: zkResult.txHash });
    } catch (zkErr) {
      console.error("zkVerify submit error:", zkErr);
      stages.push({ id: "submit", label: "ZKVERIFY SUBMIT", ms: Date.now() - submitStart, status: "error", error: zkErr.message });
    }

    // Stage 4: Record Mining on Base
    const recordStart = Date.now();
    const { oreType, isRare, randomOutput } = proofResult.parsed;
    const walletClient = getOwnerWallet();
    const recordHash = await walletClient.writeContract({
      address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "recordMining",
      args: [player, gridX, gridY, oreType, isRare, BigInt(randomOutput)],
      gas: 300000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: recordHash });
    stages.push({ id: "record", label: "BASE RECORD", ms: Date.now() - recordStart, status: receipt.status === "success" ? "done" : "error", txHash: recordHash });

    return res.status(200).json({
      success: true,
      cell: { gridX, gridY },
      ore: { type: oreType, isRare, randomOutput },
      proof: {
        zkVerifyTxHash: zkResult?.txHash || null,
        leaf: zkResult?.leaf || null,
        attestationId: zkResult?.attestationId || null,
        domainId: 4,
      },
      base: { recordTxHash: recordHash, blockNumber: Number(receipt.blockNumber) },
      stages,
      totalMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error("Mine API error:", err);
    return res.status(500).json({ error: err.message || "Mining failed", stages, totalMs: Date.now() - startTime });
  }
}
