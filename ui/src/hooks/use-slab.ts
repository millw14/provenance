import { useState, useEffect, useRef, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  fetchSlab,
  parseHeader,
  parseConfig,
  parseEngine,
  parseParams,
  parseAllAccounts,
  type SlabHeader,
  type MarketConfig,
  type EngineState,
  type RiskParams,
  type Account,
} from "@parsers/slab";

export interface SlabSnapshot {
  header: SlabHeader;
  config: MarketConfig;
  engine: EngineState;
  params: RiskParams;
  accounts: { idx: number; account: Account }[];
  fetchedAt: number; // Date.now()
  slot: bigint;
}

export interface UseSlabResult {
  data: SlabSnapshot | null;
  error: string | null;
  loading: boolean;
  /** History of snapshots collected this session (for insurance chart) */
  history: SlabSnapshot[];
}

const DEFAULT_POLL_MS = 5_000;

/**
 * Single hook that fetches + parses the entire slab on an interval.
 * Returns all parsed state. History accumulates in-memory (lost on refresh).
 */
export function useSlab(
  rpcUrl: string,
  slabAddress: string,
  pollMs: number = DEFAULT_POLL_MS
): UseSlabResult {
  const [data, setData] = useState<SlabSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const historyRef = useRef<SlabSnapshot[]>([]);
  const [history, setHistory] = useState<SlabSnapshot[]>([]);

  const fetch = useCallback(async () => {
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const pubkey = new PublicKey(slabAddress);
      const raw = await fetchSlab(connection, pubkey);

      const header = parseHeader(raw);
      const config = parseConfig(raw);
      const engine = parseEngine(raw);
      const params = parseParams(raw);
      const accounts = parseAllAccounts(raw);

      const snapshot: SlabSnapshot = {
        header,
        config,
        engine,
        params,
        accounts,
        fetchedAt: Date.now(),
        slot: engine.currentSlot,
      };

      setData(snapshot);
      setError(null);

      historyRef.current = [...historyRef.current, snapshot];
      setHistory(historyRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rpcUrl, slabAddress]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, pollMs);
    return () => clearInterval(id);
  }, [fetch, pollMs]);

  return { data, error, loading, history };
}
