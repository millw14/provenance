import { useState, useEffect, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

export interface ProgramTrustInfo {
  programId: string;
  upgradeable: boolean;
  upgradeAuthority: string | null;
  lastDeployedSlot: bigint;
}

/**
 * Fetches BPF Upgradeable Loader program data to determine
 * whether a program is upgradeable and who holds the authority.
 *
 * Program account layout (type 2):
 *   type(4 bytes) + programdata_address(32 bytes)
 *
 * ProgramData account layout (type 3):
 *   type(4 bytes) + slot(8 bytes) + authority_option(1 byte) + authority(32 bytes if Some)
 */
async function fetchProgramTrust(
  connection: Connection,
  programId: PublicKey
): Promise<ProgramTrustInfo> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo) {
    throw new Error(`Program not found: ${programId.toBase58()}`);
  }

  // Read programdata address from program account
  const programDataAddress = new PublicKey(programInfo.data.subarray(4, 36));
  const pdInfo = await connection.getAccountInfo(programDataAddress);
  if (!pdInfo) {
    throw new Error(`ProgramData not found: ${programDataAddress.toBase58()}`);
  }

  const pdData = pdInfo.data;
  const lastDeployedSlot = pdData.readBigUInt64LE(4);
  const authorityTag = pdData.readUInt8(12);

  let upgradeAuthority: string | null = null;
  let upgradeable = false;

  if (authorityTag === 1) {
    upgradeAuthority = new PublicKey(pdData.subarray(13, 45)).toBase58();
    upgradeable = true;
  }

  return {
    programId: programId.toBase58(),
    upgradeable,
    upgradeAuthority,
    lastDeployedSlot,
  };
}

export interface UseProgramTrustResult {
  programs: ProgramTrustInfo[];
  loading: boolean;
  error: string | null;
}

/**
 * Hook that checks upgrade authority for the Percolator programs.
 * Fetched once on mount (programs don't change frequently).
 */
export function useProgramTrust(
  rpcUrl: string,
  programIds: string[]
): UseProgramTrustResult {
  const [programs, setPrograms] = useState<ProgramTrustInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    if (programIds.length === 0) {
      setLoading(false);
      return;
    }

    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const results: ProgramTrustInfo[] = [];

      for (const id of programIds) {
        try {
          const info = await fetchProgramTrust(
            connection,
            new PublicKey(id)
          );
          results.push(info);
        } catch {
          // If we can't fetch one program, still show the others
          results.push({
            programId: id,
            upgradeable: true, // assume worst case
            upgradeAuthority: "unknown",
            lastDeployedSlot: 0n,
          });
        }
      }

      setPrograms(results);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rpcUrl, programIds.join(",")]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { programs, loading, error };
}
