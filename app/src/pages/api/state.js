// ═══════════════════════════════════════════════════════════════
// GET /api/state — Read grid state from Base contract
//
// Query params:
//   ?player=0x... — include player-specific stats
//   ?viewport=x,y,w,h — only return cells in viewport
//   ?full=true — return all 1024 cells
// ═══════════════════════════════════════════════════════════════

import { GRIDZERO_ADDR, publicClient, GRID_SIZE } from "@/lib/chain";
import { GRID_ABI } from "@/lib/abi";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { player, viewport, full } = req.query;
    const result = {};

    // ─── Global Stats ───
    const [totalMined, difficulty, vrfDomain, lbDomain, diffDomain] = await Promise.all([
      publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "totalMined" }),
      publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "difficultyThreshold" }),
      publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "vrfDomainId" }),
      publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "leaderboardDomainId" }),
      publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "difficultyDomainId" }),
    ]);
    result.global = {
      totalMined: Number(totalMined),
      difficulty: Number(difficulty),
      gridSize: GRID_SIZE,
      domains: { vrf: Number(vrfDomain), leaderboard: Number(lbDomain), difficulty: Number(diffDomain) },
    };

    // ─── Player Stats ───
    if (player) {
      try {
        const stats = await publicClient.readContract({
          address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getPlayerStats", args: [player],
        });
        result.player = {
          address: player,
          totalMined: Number(stats.totalMined),
          score: Number(stats.score),
          oreInventory: stats.oreInventory.map(Number),
          lastMineBlock: Number(stats.lastMineBlock),
        };
      } catch (e) {
        result.player = { address: player, totalMined: 0, score: 0, oreInventory: [0,0,0,0,0,0,0,0] };
      }
    }

    // ─── Grid Cells (viewport or full) ───
    if (viewport || full === "true") {
      let sx = 0, sy = 0, w = GRID_SIZE, h = GRID_SIZE;
      if (viewport) {
        const parts = viewport.split(",").map(Number);
        sx = parts[0] || 0; sy = parts[1] || 0; w = parts[2] || 10; h = parts[3] || 10;
      }

      const calls = [];
      const coords = [];
      for (let y = sy; y < Math.min(sy + h, GRID_SIZE); y++) {
        for (let x = sx; x < Math.min(sx + w, GRID_SIZE); x++) {
          calls.push({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "isMined", args: [x, y] });
          coords.push({ x, y });
        }
      }
      const minedResults = await publicClient.multicall({ contracts: calls });

      const detailCalls = [];
      const detailCoords = [];
      minedResults.forEach((r, i) => {
        if (r.result) {
          detailCalls.push({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getCell", args: [coords[i].x, coords[i].y] });
          detailCoords.push(coords[i]);
        }
      });

      const cellMap = {};
      if (detailCalls.length > 0) {
        const details = await publicClient.multicall({ contracts: detailCalls });
        details.forEach((d, i) => {
          if (d.result) {
            const c = d.result;
            const { x, y } = detailCoords[i];
            cellMap[`${x},${y}`] = {
              player: c.player, gridX: Number(c.gridX), gridY: Number(c.gridY),
              oreType: Number(c.oreType), isRare: c.isRare, settled: c.settled,
              timestamp: Number(c.timestamp),
            };
          }
        });
      }
      result.cells = cellMap;
      result.viewport = { x: sx, y: sy, w, h };
    }

    // ─── Leaderboard ───
    try {
      const topPlayers = await publicClient.readContract({ address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getTopPlayers" });
      if (topPlayers.length > 0) {
        const scoreCalls = topPlayers.slice(0, 10).map(addr => ({
          address: GRIDZERO_ADDR, abi: GRID_ABI, functionName: "getPlayerScore", args: [addr],
        }));
        const scores = await publicClient.multicall({ contracts: scoreCalls });
        result.leaderboard = topPlayers.slice(0, 10).map((addr, i) => ({
          address: addr, score: Number(scores[i]?.result || 0n),
        }));
      }
    } catch (e) {
      result.leaderboard = [];
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("State API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
