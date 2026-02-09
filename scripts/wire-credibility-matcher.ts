/**
 * wire-credibility-matcher.ts
 *
 * Creates a new LP on the existing adminless market that uses the
 * credibility matcher instead of the passive matcher. Then calls
 * UpdateCredibility to seed the insurance/OI snapshots.
 *
 * The existing market at slab 75h2kF58m3ms77c8WwzQh6h4iT2XMA1F5Mk13FZ6CCUs
 * already has LP 0 with the passive matcher. This creates LP 1 with
 * the credibility matcher.
 */
import "dotenv/config";
import {
  Connection, Keypair, PublicKey, Transaction,
  sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram,
  SYSVAR_CLOCK_PUBKEY, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, NATIVE_MINT,
} from "@solana/spl-token";
import * as fs from "fs";
import {
  encodeInitLP, encodeDepositCollateral,
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_LP, ACCOUNTS_DEPOSIT_COLLATERAL,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveLpPda } from "../src/solana/pda.js";
import { buildIx } from "../src/runtime/tx.js";
import { parseUsedIndices } from "../src/solana/slab.js";

// ---------------------------------------------------------------------------
// Existing market
// ---------------------------------------------------------------------------
const SLAB_PUBKEY = new PublicKey("75h2kF58m3ms77c8WwzQh6h4iT2XMA1F5Mk13FZ6CCUs");
const VAULT_PUBKEY = new PublicKey("8yVk7ULLjErxGAUDU6a4LGpLmCvD7K69Z7dkSBvz74Th");
const PERCOLATOR_PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");

// Our credibility matcher program (just deployed)
const CREDIBILITY_MATCHER_ID = new PublicKey("CeBbeMPBvWBwMiCJUCDFjupvkdzrxRxqoEueskZBziyU");

const MATCHER_CTX_SIZE = 320;
const LP_COLLATERAL = 500_000_000n; // 0.5 SOL

// ---------------------------------------------------------------------------
const conn = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed"
);
const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
const payer = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
);

async function main() {
  console.log("=== WIRE CREDIBILITY MATCHER ===\n");

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`Wallet:  ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Slab:    ${SLAB_PUBKEY.toBase58()}`);
  console.log(`Matcher: ${CREDIBILITY_MATCHER_ID.toBase58()}\n`);

  // Read slab to find next LP index
  const slabInfo = await conn.getAccountInfo(SLAB_PUBKEY);
  if (!slabInfo) {
    console.error("ERROR: Slab not found");
    process.exit(1);
  }
  const usedIndices = parseUsedIndices(slabInfo.data);
  const lpIndex = usedIndices.length;
  console.log(`Existing accounts: ${usedIndices.length}, new LP will be index ${lpIndex}\n`);

  // Get wSOL ATA
  const adminAta = await getOrCreateAssociatedTokenAccount(conn, payer, NATIVE_MINT, payer.publicKey);
  const ataBalance = Number(adminAta.amount);
  console.log(`wSOL ATA balance: ${ataBalance / LAMPORTS_PER_SOL} SOL`);

  // Wrap more SOL if needed
  const needed = Number(LP_COLLATERAL) + 10_000_000;
  if (ataBalance < needed) {
    const wrapAmount = needed - ataBalance + 100_000_000; // extra buffer
    console.log(`Wrapping ${wrapAmount / LAMPORTS_PER_SOL} SOL...`);
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: adminAta.address, lamports: wrapAmount }),
      { programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: adminAta.address, isSigner: false, isWritable: true }], data: Buffer.from([17]) },
    );
    await sendAndConfirmTransaction(conn, wrapTx, [payer], { commitment: "confirmed" });
  }

  // ========================================================================
  // STEP 1: Create matcher context account
  // ========================================================================
  console.log("\n--- Step 1: Create Matcher Context ---\n");

  const matcherCtxKp = Keypair.generate();
  const matcherRent = await conn.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);
  const createCtxTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: matcherCtxKp.publicKey,
      lamports: matcherRent,
      space: MATCHER_CTX_SIZE,
      programId: CREDIBILITY_MATCHER_ID,
    }),
  );
  await sendAndConfirmTransaction(conn, createCtxTx, [payer, matcherCtxKp], { commitment: "confirmed" });
  console.log(`Matcher context: ${matcherCtxKp.publicKey.toBase58()}`);

  // ========================================================================
  // STEP 2: Initialize matcher context (Tag 2, 74 bytes)
  // ========================================================================
  console.log("\n--- Step 2: Init Matcher Context ---\n");

  const [lpPda] = deriveLpPda(PERCOLATOR_PROGRAM_ID, SLAB_PUBKEY, lpIndex);
  console.log(`LP PDA: ${lpPda.toBase58()}`);

  // Build 74-byte init instruction for credibility matcher:
  // tag=2, kind=2 (Credibility),
  // base_fee_bps=5, min_spread_bps=50, max_spread_bps=500,
  // imbalance_k_bps=100, liquidity_e6=1_000_000_000_000,
  // max_fill=1_000_000_000_000, max_inventory=0,
  // age_halflife=216000 (~1 day at 2.5 slots/sec), insurance_weight_bps=50
  const initData = Buffer.alloc(74);
  let off = 0;
  initData.writeUInt8(2, off); off += 1;           // tag = 2
  initData.writeUInt8(2, off); off += 1;           // kind = 2 (Credibility)
  initData.writeUInt32LE(5, off); off += 4;        // base_fee_bps
  initData.writeUInt32LE(50, off); off += 4;       // min_spread_bps (0.50%)
  initData.writeUInt32LE(500, off); off += 4;      // max_spread_bps (5.00%)
  initData.writeUInt32LE(100, off); off += 4;      // imbalance_k_bps
  // liquidity_e6 = 1_000_000_000_000 (u128 LE at offset 18)
  writeBigU128(initData, off, 1_000_000_000_000n); off += 16;
  // max_fill = 1_000_000_000_000 (u128 LE)
  writeBigU128(initData, off, 1_000_000_000_000n); off += 16;
  // max_inventory = 0 (u128 LE, no limit)
  writeBigU128(initData, off, 0n); off += 16;
  initData.writeUInt32LE(216000, off); off += 4;   // age_halflife_slots (~1 day)
  initData.writeUInt32LE(50, off); off += 4;       // insurance_weight_bps (50 = 0.50%)

  const initMatcherTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    { programId: CREDIBILITY_MATCHER_ID, keys: [
      { pubkey: lpPda, isSigner: false, isWritable: false },
      { pubkey: matcherCtxKp.publicKey, isSigner: false, isWritable: true },
    ], data: initData },
  );
  await sendAndConfirmTransaction(conn, initMatcherTx, [payer], { commitment: "confirmed" });
  console.log("Matcher context initialized (Credibility, 50bps spread, 50bps insurance weight)");

  // ========================================================================
  // STEP 3: Create LP with credibility matcher
  // ========================================================================
  console.log("\n--- Step 3: Init LP ---\n");

  const initLpTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PERCOLATOR_PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_INIT_LP, [
      payer.publicKey, SLAB_PUBKEY, adminAta.address, VAULT_PUBKEY, TOKEN_PROGRAM_ID,
    ]), data: encodeInitLP({
      matcherProgram: CREDIBILITY_MATCHER_ID,
      matcherContext: matcherCtxKp.publicKey,
      feePayment: "2000000",
    }) }),
  );
  await sendAndConfirmTransaction(conn, initLpTx, [payer], { commitment: "confirmed" });
  console.log(`LP ${lpIndex} created with credibility matcher`);

  // ========================================================================
  // STEP 4: Deposit collateral to LP
  // ========================================================================
  console.log("\n--- Step 4: Fund LP ---\n");

  const depositTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PERCOLATOR_PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
      payer.publicKey, SLAB_PUBKEY, adminAta.address, VAULT_PUBKEY, TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY,
    ]), data: encodeDepositCollateral({ userIdx: lpIndex, amount: LP_COLLATERAL.toString() }) }),
  );
  await sendAndConfirmTransaction(conn, depositTx, [payer], { commitment: "confirmed" });
  console.log(`LP funded: ${Number(LP_COLLATERAL) / 1e9} SOL`);

  // ========================================================================
  // STEP 5: Update credibility snapshots (Tag 3)
  // ========================================================================
  console.log("\n--- Step 5: Seed Credibility Snapshots ---\n");

  const updateCredTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    { programId: CREDIBILITY_MATCHER_ID, keys: [
      { pubkey: matcherCtxKp.publicKey, isSigner: false, isWritable: true },
      { pubkey: SLAB_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ], data: Buffer.from([3]) },  // Tag 3 = UpdateCredibility
  );
  await sendAndConfirmTransaction(conn, updateCredTx, [payer], { commitment: "confirmed" });
  console.log("Credibility snapshots seeded from slab state");

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("\n=== DONE ===\n");
  console.log("Credibility matcher is live on the adminless market.\n");
  console.log(`  Program:         ${CREDIBILITY_MATCHER_ID.toBase58()}`);
  console.log(`  Matcher Context: ${matcherCtxKp.publicKey.toBase58()}`);
  console.log(`  LP Index:        ${lpIndex}`);
  console.log(`  LP PDA:          ${lpPda.toBase58()}`);
  console.log(`  Slab:            ${SLAB_PUBKEY.toBase58()}`);
  console.log("");
  console.log("The market now has two LPs:");
  console.log("  LP 0: Passive matcher (50bps fixed spread)");
  console.log(`  LP ${lpIndex}: Credibility matcher (spreads adjust with insurance/OI ratio)`);
  console.log("");
  console.log("Anyone can call UpdateCredibility (Tag 3) to refresh the insurance/OI snapshots.");
  console.log("As insurance grows relative to OI, spreads on LP 1 will tighten automatically.");

  // Save info
  const info = {
    credibilityMatcherProgram: CREDIBILITY_MATCHER_ID.toBase58(),
    matcherContext: matcherCtxKp.publicKey.toBase58(),
    lpIndex,
    lpPda: lpPda.toBase58(),
    slab: SLAB_PUBKEY.toBase58(),
    params: {
      baseFee: "5 bps",
      minSpread: "50 bps",
      maxSpread: "500 bps",
      imbalanceK: "100 bps",
      insuranceWeight: "50 bps",
      ageHalflife: "216000 slots (~1 day)",
    },
  };
  fs.writeFileSync("credibility-matcher.json", JSON.stringify(info, null, 2));
  console.log("\nSaved to credibility-matcher.json");
}

function writeBigU128(buf: Buffer, offset: number, val: bigint) {
  for (let i = 0; i < 16; i++) {
    buf[offset + i] = Number((val >> BigInt(i * 8)) & 0xFFn);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
