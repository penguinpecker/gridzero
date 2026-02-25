// ═══════════════════════════════════════════════════════════════
// POST /api/settle — Settle mining results on Base
//
// After zkVerify aggregation completes and root is relayed to Base,
// calls settleMining() with the Merkle inclusion proof.
//
// Single:  { gridX, gridY, attestationData }
// Batch:   { cells: [{ gridX, gridY, attestationData }] }
// ═══════════════════════════════════════════════════════════════

import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getMerklePath } from "@/lib/zkverify-client";
import { GRIDZERO_ADDR, publicClient, ZKVERIFY_DOMAINS } from "@/lib/chain";
import { GRID_ABI } from "@/lib/abi";

function getOwnerWallet() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set");
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  return createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    const walletClient = getOwnerWallet();

    // ─── Single Settlement ───
    if (body.gridX !== undefined) {
      const { gridX, gridY, attestationData } = body;

      let data = attestationData;
      if (data.attestationId && !data.merklePath) {
        const pathResult = await getMerklePath(data.attestationId, data.leaf);
        data = {
          domainId: data.domainId || ZKVERIFY_DOMAINS.VRF,
          aggregationId: pathResult.aggregationId || data.attestationId,
          leaf: data.leaf,
          merklePath: pathResult.proof || pathResult.path,
          leafCount: pathResult.numberOfLeaves || pathResult.leafCount,
          index: pathResult.leafIndex || pathResult.index,
        };
      }

      const txHash = await walletClient.writeContract({
        address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "settleMining",
        args: [gridX, gridY, BigInt(data.domainId), BigInt(data.aggregationId), data.leaf, data.merklePath, BigInt(data.leafCount), BigInt(data.index)],
        gas: 500000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return res.status(200).json({
        success: receipt.status === "success",
        txHash,
        blockNumber: Number(receipt.blockNumber),
        cell: { gridX, gridY },
      });
    }

    // ─── Batch Settlement ───
    if (body.cells && body.cells.length > 0) {
      const { cells } = body;
      const gridXs = [], gridYs = [], leaves = [], merklePaths = [], leafCounts = [], indices = [];
      let domainId, aggregationId;

      for (const cell of cells) {
        let data = cell.attestationData;
        if (data.attestationId && !data.merklePath) {
          const pathResult = await getMerklePath(data.attestationId, data.leaf);
          data = {
            domainId: data.domainId || ZKVERIFY_DOMAINS.VRF,
            aggregationId: pathResult.aggregationId || data.attestationId,
            leaf: data.leaf,
            merklePath: pathResult.proof || pathResult.path,
            leafCount: pathResult.numberOfLeaves || pathResult.leafCount,
            index: pathResult.leafIndex || pathResult.index,
          };
        }
        gridXs.push(cell.gridX);
        gridYs.push(cell.gridY);
        domainId = BigInt(data.domainId);
        aggregationId = BigInt(data.aggregationId);
        leaves.push(data.leaf);
        merklePaths.push(data.merklePath);
        leafCounts.push(BigInt(data.leafCount));
        indices.push(BigInt(data.index));
      }

      const txHash = await walletClient.writeContract({
        address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "batchSettleMining",
        args: [gridXs, gridYs, domainId, aggregationId, leaves, merklePaths, leafCounts, indices],
        gas: BigInt(300000 * cells.length),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return res.status(200).json({
        success: receipt.status === "success",
        txHash,
        blockNumber: Number(receipt.blockNumber),
        count: cells.length,
      });
    }

    return res.status(400).json({ error: "Missing gridX/gridY or cells array" });
  } catch (err) {
    console.error("Settle API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
