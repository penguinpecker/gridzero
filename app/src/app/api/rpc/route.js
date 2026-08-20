// ═══════════════════════════════════════════════════════════════
// Server-side JSON-RPC proxy for Base.
//
// The upstream URL lives in ALCHEMY_RPC_URL — deliberately WITHOUT the
// NEXT_PUBLIC_ prefix, so Next never inlines it into the client bundle.
// The browser talks to /api/rpc; only this route sees the key.
//
// Reads only: the allowlist below blocks this endpoint from being used
// as a general-purpose relay if someone finds it.
// ═══════════════════════════════════════════════════════════════

const UPSTREAM = process.env.ALCHEMY_RPC_URL || "https://mainnet.base.org";

const ALLOWED_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getLogs",
]);

function rejected(id, method) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32601, message: `Method not allowed: ${method}` },
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  // viem may send a single call or a batch
  const calls = Array.isArray(body) ? body : [body];
  const blocked = calls.filter((c) => !ALLOWED_METHODS.has(c?.method));
  if (blocked.length) {
    const errors = blocked.map((c) => rejected(c?.id, c?.method));
    return Response.json(Array.isArray(body) ? errors : errors[0], { status: 403 });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Upstream RPC unavailable" } },
      { status: 502 }
    );
  }
}

export const dynamic = "force-dynamic";
