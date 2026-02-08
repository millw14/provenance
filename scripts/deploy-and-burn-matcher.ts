/**
 * deploy-and-burn-matcher.ts
 *
 * Builds, deploys, and burns the upgrade authority of the credibility matcher.
 * After this script, the matcher program is permanently immutable.
 *
 * Prerequisites:
 *   - Rust + Solana CLI + cargo-build-sbf installed
 *   - Funded devnet wallet
 *
 * Usage:
 *   npx tsx scripts/deploy-and-burn-matcher.ts
 */
import "dotenv/config";
import { execSync } from "child_process";
import * as fs from "fs";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MATCHER_DIR = "matcher/credibility";
const SO_PATH = `${MATCHER_DIR}/target/deploy/credibility_matcher.so`;

function run(cmd: string, opts?: { cwd?: string }): string {
  console.log(`$ ${cmd}`);
  const result = execSync(cmd, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    cwd: opts?.cwd,
  });
  return result.trim();
}

async function main() {
  console.log("=== DEPLOY AND BURN MATCHER ===\n");

  // -----------------------------------------------------------------------
  // Phase 1: Build
  // -----------------------------------------------------------------------
  console.log("--- Phase 1: Build ---\n");

  try {
    run("cargo build-sbf", { cwd: MATCHER_DIR });
    console.log("Build complete.\n");
  } catch (e: any) {
    console.error("Build failed. Make sure cargo-build-sbf is installed.");
    console.error("  cargo install solana-cli");
    console.error(e.stderr || e.message);
    process.exit(1);
  }

  if (!fs.existsSync(SO_PATH)) {
    console.error(`Expected .so at ${SO_PATH} but not found.`);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Phase 2: Deploy
  // -----------------------------------------------------------------------
  console.log("--- Phase 2: Deploy ---\n");

  let programId: string;
  try {
    const deployOutput = run(
      `solana program deploy ${SO_PATH} --url ${RPC_URL}`
    );
    // Output: "Program Id: <PUBKEY>"
    const match = deployOutput.match(/Program Id:\s+(\S+)/);
    if (!match) {
      console.error("Could not parse program ID from deploy output:");
      console.error(deployOutput);
      process.exit(1);
    }
    programId = match[1];
    console.log(`Deployed: ${programId}\n`);
  } catch (e: any) {
    console.error("Deploy failed.");
    console.error(e.stderr || e.message);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Phase 3: Verify pre-burn state
  // -----------------------------------------------------------------------
  console.log("--- Phase 3: Pre-burn verification ---\n");

  const preBurn = run(`solana program show ${programId} --url ${RPC_URL}`);
  console.log(preBurn);
  console.log("");

  // -----------------------------------------------------------------------
  // Phase 4: Burn upgrade authority
  // -----------------------------------------------------------------------
  console.log("--- Phase 4: Burn upgrade authority ---\n");
  console.log("WARNING: This is IRREVERSIBLE. The program will be permanently immutable.\n");

  try {
    const burnOutput = run(
      `solana program set-upgrade-authority ${programId} --final --url ${RPC_URL}`
    );
    console.log(burnOutput);
    console.log("");
  } catch (e: any) {
    console.error("Burn failed.");
    console.error(e.stderr || e.message);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Phase 5: Verify post-burn state
  // -----------------------------------------------------------------------
  console.log("--- Phase 5: Post-burn verification ---\n");

  const postBurn = run(`solana program show ${programId} --url ${RPC_URL}`);
  console.log(postBurn);
  console.log("");

  // Check for "Authority: none" or similar
  const authorityNone =
    postBurn.includes("Authority: none") ||
    postBurn.includes("Authority: None") ||
    !postBurn.match(/Authority:\s+[A-Za-z0-9]{32,}/);

  if (authorityNone) {
    console.log("VERDICT: Matcher program is IMMUTABLE.");
    console.log(`Program ID: ${programId}`);
    console.log("No entity can modify this program. Ever.");
  } else {
    console.log("WARNING: Upgrade authority may still be active.");
    console.log("Verify manually: solana program show " + programId);
  }

  // Save result
  const result = {
    programId,
    network: RPC_URL.includes("devnet") ? "devnet" : "unknown",
    immutable: authorityNone,
    deployedAt: new Date().toISOString(),
    soPath: SO_PATH,
  };

  fs.writeFileSync("matcher-deploy.json", JSON.stringify(result, null, 2));
  console.log("\nSaved to matcher-deploy.json");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
