import { zkVerifySession, Library, CurveType } from "zkverifyjs";

const ZKVERIFY_DOMAINS = { VRF: 4, LEADERBOARD: 5, DIFFICULTY: 6 };

let sessionCache = null;

async function getSession() {
  if (!sessionCache) {
    const seedPhrase = process.env.ZKVERIFY_SEED_PHRASE;
    if (!seedPhrase) throw new Error("ZKVERIFY_SEED_PHRASE not set");
    sessionCache = await zkVerifySession
      .start()
      .zkVerify()
      .withAccount(seedPhrase);
  }
  return sessionCache;
}

export async function submitProofQuick(proof, publicSignals, vkey) {
  const session = await getSession();

  const { events, transactionResult } = await session
    .verify()
    .groth16({ library: Library.snarkjs, curve: CurveType.bn128 })
    .execute({
      proofData: {
        proof: proof,
        publicSignals: publicSignals,
        vk: vkey,
      },
      domainId: ZKVERIFY_DOMAINS.VRF,
    });

  const result = await transactionResult;

  return {
    txHash: result.txHash,
    leaf: result.leaf || result.statement,
    attestationId: result.attestationId,
  };
}

export async function getMerklePath(attestationId, leaf) {
  const session = await getSession();
  return session.getAggregateStatementPath(attestationId, leaf);
}

export async function closeSession() {
  if (sessionCache) {
    await sessionCache.close();
    sessionCache = null;
  }
}
