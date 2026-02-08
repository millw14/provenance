import { useState } from "react";
import { Layout, type Screen } from "./components/Layout";
import { useSlab } from "./hooks/use-slab";
import { Overview } from "./screens/Overview";
import { Insurance } from "./screens/Insurance";
import { Risk } from "./screens/Risk";
import { Trade } from "./screens/Trade";
import styles from "./App.module.css";

// Defaults -- override with query params ?rpc=...&slab=...
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_SLAB = ""; // must be provided

function getParams(): { rpc: string; slab: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    rpc: params.get("rpc") || DEFAULT_RPC,
    slab: params.get("slab") || DEFAULT_SLAB,
  };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("overview");
  const { rpc, slab } = getParams();

  const { data, error, loading, history } = useSlab(rpc, slab, 5_000);

  // No slab address configured
  if (!slab) {
    return (
      <Layout activeScreen={screen} onNavigate={setScreen}>
        <div className={styles.status}>
          <p className={styles.statusTitle}>No market configured</p>
          <p className={styles.statusDetail}>
            Pass the slab account address as a query parameter:
          </p>
          <code className={styles.code}>
            ?slab=YOUR_SLAB_ADDRESS&rpc=https://api.devnet.solana.com
          </code>
        </div>
      </Layout>
    );
  }

  // Loading state
  if (loading && !data) {
    return (
      <Layout activeScreen={screen} onNavigate={setScreen}>
        <div className={styles.status}>
          <p className={styles.statusDetail}>Fetching slab data...</p>
        </div>
      </Layout>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <Layout activeScreen={screen} onNavigate={setScreen}>
        <div className={styles.status}>
          <p className={styles.statusTitle}>Error</p>
          <p className={styles.statusDetail}>{error}</p>
        </div>
      </Layout>
    );
  }

  if (!data) return null;

  return (
    <Layout activeScreen={screen} onNavigate={setScreen}>
      {screen === "overview" && <Overview data={data} rpcUrl={rpc} />}
      {screen === "insurance" && <Insurance data={data} history={history} />}
      {screen === "risk" && <Risk data={data} />}
      {screen === "trade" && <Trade />}
    </Layout>
  );
}
