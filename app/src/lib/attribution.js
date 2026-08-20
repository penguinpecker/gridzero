import { Attribution } from "ox/erc8021";

// ═══════════════════════════════════════════════════════════════
// Base Builder Code — ERC-8021 onchain attribution
// Code from base.dev > Settings > Builder Code
// ═══════════════════════════════════════════════════════════════
export const BUILDER_CODE = "bc_d5xapxoe";

// Suffix appended to the end of every transaction's calldata.
// Contracts ignore trailing bytes beyond their expected args, so this is
// inert to execution — Base's offchain indexers read it for attribution.
// Resolves to: 0x62635f6435786170786f650b0080218021802180218021802180218021
//   bc_d5xapxoe (ASCII) ∥ 0x0b length ∥ 0x00 schemaId ∥ 16-byte ERC-8021 marker
export const DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

// Append the attribution suffix to already-encoded calldata.
export function withAttribution(data) {
  return `${data}${DATA_SUFFIX.slice(2)}`;
}
