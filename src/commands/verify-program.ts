import { Command } from "commander";
import { PublicKey, Connection } from "@solana/web3.js";
import { getGlobalFlags } from "../cli.js";
import { loadConfig } from "../config.js";
import { createContext } from "../runtime/context.js";
import { validatePublicKey } from "../validation.js";

/**
 * BPF Upgradeable Loader program data account layout:
 *   - bytes 0..3:  account type (u32 LE) — 3 = ProgramData
 *   - bytes 4..11: slot deployed (u64 LE)
 *   - bytes 12..12: option tag (1 = Some, 0 = None) for upgrade authority
 *   - bytes 13..44: upgrade authority pubkey (if tag == 1)
 */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111111"
);

interface ProgramTrust {
  programId: string;
  owner: string;
  upgradeable: boolean;
  upgradeAuthority: string | null;
  lastDeployedSlot: bigint;
  dataLength: number;
  isBpfUpgradeable: boolean;
}

async function fetchProgramTrust(
  connection: Connection,
  programId: PublicKey
): Promise<ProgramTrust> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo) {
    throw new Error(`Program account not found: ${programId.toBase58()}`);
  }

  const owner = new PublicKey(programInfo.owner).toBase58();
  const isBpfUpgradeable = owner === BPF_LOADER_UPGRADEABLE.toBase58();

  if (!isBpfUpgradeable) {
    return {
      programId: programId.toBase58(),
      owner,
      upgradeable: false,
      upgradeAuthority: null,
      lastDeployedSlot: 0n,
      dataLength: programInfo.data.length,
      isBpfUpgradeable: false,
    };
  }

  // For BPF Upgradeable programs, the program account's data contains
  // a 4-byte type tag followed by the programdata address (32 bytes).
  // Type 2 = Program account, type 3 = ProgramData account.
  const programData = programInfo.data;

  // Program account layout: type(4) + programdata_address(32)
  const programDataAddress = new PublicKey(programData.subarray(4, 36));

  // Fetch the ProgramData account
  const pdInfo = await connection.getAccountInfo(programDataAddress);
  if (!pdInfo) {
    throw new Error(
      `ProgramData account not found: ${programDataAddress.toBase58()}`
    );
  }

  const pdData = pdInfo.data;
  const lastDeployedSlot = pdData.readBigUInt64LE(4);

  // Authority option: byte 12 is the tag (1 = Some, 0 = None)
  const authorityTag = pdData.readUInt8(12);
  let upgradeAuthority: string | null = null;
  let upgradeable = false;

  if (authorityTag === 1) {
    upgradeAuthority = new PublicKey(pdData.subarray(13, 45)).toBase58();
    upgradeable = true;
  }

  return {
    programId: programId.toBase58(),
    owner,
    upgradeable,
    upgradeAuthority,
    lastDeployedSlot,
    dataLength: pdInfo.data.length,
    isBpfUpgradeable: true,
  };
}

export function registerVerifyProgram(program: Command): void {
  program
    .command("verify-program")
    .description(
      "Check program upgrade authority and trust status"
    )
    .requiredOption("--program-id <pubkey>", "Program ID to check (can be repeated)", collect, [])
    .action(async (opts, cmd) => {
      const flags = getGlobalFlags(cmd);
      const config = loadConfig(flags);
      const ctx = createContext(config);

      const programIds: string[] = opts.programId;
      if (programIds.length === 0) {
        // Default: check both Percolator programs
        programIds.push(
          "2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp",
          "4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy"
        );
      }

      const results: ProgramTrust[] = [];

      for (const id of programIds) {
        const pk = validatePublicKey(id, "--program-id");
        const trust = await fetchProgramTrust(ctx.connection, pk);
        results.push(trust);
      }

      if (flags.json) {
        console.log(JSON.stringify(results, (_, v) =>
          typeof v === "bigint" ? v.toString() : v, 2));
      } else {
        console.log("=== Program Trust Verification ===\n");

        for (const r of results) {
          console.log(`Program: ${r.programId}`);
          console.log(`  Owner:             ${r.owner}`);
          console.log(`  BPF Upgradeable:   ${r.isBpfUpgradeable ? "yes" : "no"}`);

          if (r.isBpfUpgradeable) {
            if (r.upgradeable) {
              console.log(`  Upgradeable:       YES`);
              console.log(`  Upgrade Authority: ${r.upgradeAuthority}`);
              console.log(`  Last Deployed:     slot ${r.lastDeployedSlot}`);
              console.log(`  Status:            MUTABLE — authority can push new bytecode`);
            } else {
              console.log(`  Upgradeable:       NO`);
              console.log(`  Upgrade Authority: none (burned)`);
              console.log(`  Last Deployed:     slot ${r.lastDeployedSlot}`);
              console.log(`  Status:            IMMUTABLE — program cannot be changed`);
            }
          } else {
            console.log(`  Status:            Non-upgradeable loader`);
          }

          console.log("");
        }

        const allImmutable = results.every((r) => !r.upgradeable);
        const anyUpgradeable = results.some((r) => r.upgradeable);

        if (allImmutable) {
          console.log(
            "VERDICT: All checked programs are IMMUTABLE. No entity can modify them."
          );
        } else if (anyUpgradeable) {
          const mutableCount = results.filter((r) => r.upgradeable).length;
          console.log(
            `VERDICT: ${mutableCount} of ${results.length} program(s) are UPGRADEABLE.`
          );
          console.log(
            "Market-level immutability (burned admin) depends on these programs not being modified."
          );
          console.log(
            "For full trustlessness, upgrade authorities should be burned or set to a multisig."
          );
        }
      }
    });
}

/** Commander helper: collect repeated options into an array */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
