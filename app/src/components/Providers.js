"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { addRpcUrlOverrideToChain } from "@privy-io/react-auth";
import { base } from "viem/chains";

const ALCHEMY_RPC = process.env.NEXT_PUBLIC_ALCHEMY_RPC || "https://base-mainnet.g.alchemy.com/v2/r6XQwbj3aRRGWp-oJkR7f";
const baseWithAlchemy = addRpcUrlOverrideToChain(base, ALCHEMY_RPC);

export default function Providers({ children }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ color: "#ff3355", padding: 40, fontFamily: "monospace" }}>
        ERROR: NEXT_PUBLIC_PRIVY_APP_ID not set
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#ff8800",
        },
        embeddedWallets: {
          createOnLogin: "all-users",
          showWalletUIs: false,
        },
        defaultChain: baseWithAlchemy,
        supportedChains: [baseWithAlchemy],
        loginMethods: ["twitter", "google", "wallet"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
