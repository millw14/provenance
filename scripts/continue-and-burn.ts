/**
 * continue-and-burn.ts
 *
 * Picks up from a partially-created market (slab already exists and is initialized).
 * Wraps SOL, creates LP, funds insurance, burns admin, prints proof.
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
  encodeTopUpInsurance, encodeUpdateAdmin,
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_LP, ACCOUNTS_DEPOSIT_COLLATERAL,
  ACCOUNTS_TOPUP_INSURANCE, ACCOUNTS_UPDATE_ADMIN,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveVaultAuthority, deriveLpPda } from "../src/solana/pda.js";
import { buildIx } from "../src/runtime/tx.js";
import { parseHeader, parseConfig, parseEngine, parseParams, parseUsedIndices } from "../src/solana/slab.js";

// ---------------------------------------------------------------------------
// Existing market from Phase 1
// ---------------------------------------------------------------------------
const SLAB_PUBKEY = new PublicKey("75h2kF58m3ms77c8WwzQh6h4iT2XMA1F5Mk13FZ6CCUs");
const VAULT_PUBKEY = new PublicKey("8yVk7ULLjErxGAUDU6a4LGpLmCvD7K69Z7dkSBvz74Th");
const CHAINLINK_SOL_USD = new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const MATCHER_PROGRAM_ID = new PublicKey("4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy");
const BURNED_ADMIN = new PublicKey("11111111111111111111111111111111");

const MATCHER_CTX_SIZE = 320;
const INSURANCE_AMOUNT = 500_000_000n;  // 0.5 SOL (reduced to save funds)
const LP_COLLATERAL = 500_000_000n;     // 0.5 SOL

// ---------------------------------------------------------------------------
const conn = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed"
);
const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
const payer = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
);

async function main() {
  console.log("=== CONTINUE AND BURN ===\n");
  console.log("Resuming from existing slab. Wrapping SOL, creating LP, funding insurance, burning admin.\n");

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`Wallet:  ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Slab:    ${SLAB_PUBKEY.toBase58()}\n`);

  // Verify slab exists
  const slabInfo = await conn.getAccountInfo(SLAB_PUBKEY);
  if (!slabInfo) {
    console.error("ERROR: Slab account not found on-chain.");
    process.exit(1);
  }
  console.log(`Slab found: ${slabInfo.data.length} bytes\n`);

  // ========================================================================
  // STEP 1: Wrap SOL for collateral + insurance
  // ========================================================================
  console.log("--- Step 1: Wrap SOL ---\n");

  const adminAta = await getOrCreateAssociatedTokenAccount(conn, payer, NATIVE_MINT, payer.publicKey);
  const ataBalance = Number(adminAta.amount);
  const neededLamports = Number(LP_COLLATERAL + INSURANCE_AMOUNT) + 10_000_000; // LP + insurance + buffer
  console.log(`wSOL ATA balance: ${ataBalance / LAMPORTS_PER_SOL} SOL, need: ${neededLamports / LAMPORTS_PER_SOL} SOL`);

  if (ataBalance < neededLamports) {
    const wrapAmount = neededLamports - ataBalance;
    console.log(`Wrapping ${wrapAmount / LAMPORTS_PER_SOL} more SOL...`);
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: adminAta.address, lamports: wrapAmount }),
      { programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: adminAta.address, isSigner: false, isWritable: true }], data: Buffer.from([17]) },
    );
    await sendAndConfirmTransaction(conn, wrapTx, [payer], { commitment: "confirmed" });
    console.log(`Wrapped ${wrapAmount / LAMPORTS_PER_SOL} SOL into wSOL ATA`);
  } else {
    console.log("Sufficient wSOL already in ATA, skipping wrap");
  }

  // ========================================================================
  // STEP 2a: Create matcher context account (reuse if already created)
  // ========================================================================
  console.log("\n--- Step 2a: Create Matcher Context ---\n");

  const usedIndices = parseUsedIndices(slabInfo.data);
  const lpIndex = usedIndices.length;
  const [lpPda] = deriveLpPda(PROGRAM_ID, SLAB_PUBKEY, lpIndex);

  // Reuse the matcher context from the previous run if it exists
  const EXISTING_MATCHER_CTX = "2f856BSRqJ44SX2kbJEdFbf9uyqswGVckSbPnTsCMKWa";
  let matcherCtxPubkey: PublicKey;

  const existingCtx = await conn.getAccountInfo(new PublicKey(EXISTING_MATCHER_CTX));
  if (existingCtx && existingCtx.owner.equals(MATCHER_PROGRAM_ID)) {
    matcherCtxPubkey = new PublicKey(EXISTING_MATCHER_CTX);
    console.log(`Reusing existing matcher context: ${matcherCtxPubkey.toBase58()}`);
  } else {
    const matcherCtxKp = Keypair.generate();
    const matcherRent = await conn.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);
    const createCtxTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey, newAccountPubkey: matcherCtxKp.publicKey,
        lamports: matcherRent, space: MATCHER_CTX_SIZE, programId: MATCHER_PROGRAM_ID,
      }),
    );
    await sendAndConfirmTransaction(conn, createCtxTx, [payer, matcherCtxKp], { commitment: "confirmed" });
    matcherCtxPubkey = matcherCtxKp.publicKey;
    console.log(`Created matcher context: ${matcherCtxPubkey.toBase58()}`);
  }

  // ========================================================================
  // STEP 2b: Initialize matcher context (Tag 2, 66 bytes)
  // ========================================================================
  console.log("\n--- Step 2b: Init Matcher Context ---\n");

  // Build the 66-byte init instruction data per the updated percolator-match ABI:
  // tag=2, kind=0 (Passive), trading_fee_bps=5, base_spread_bps=50,
  // max_total_bps=200, impact_k_bps=0, liquidity_notional_e6=0,
  // max_fill_abs=1_000_000_000_000 (large), max_inventory_abs=0 (no limit)
  const initMatcherData = Buffer.alloc(66);
  initMatcherData.writeUInt8(2, 0);           // tag = 2 (init)
  initMatcherData.writeUInt8(0, 1);           // kind = 0 (Passive)
  initMatcherData.writeUInt32LE(5, 2);        // trading_fee_bps = 5 (0.05%)
  initMatcherData.writeUInt32LE(50, 6);       // base_spread_bps = 50 (0.50%)
  initMatcherData.writeUInt32LE(200, 10);     // max_total_bps = 200 (2.00%)
  initMatcherData.writeUInt32LE(0, 14);       // impact_k_bps = 0 (passive)
  // liquidity_notional_e6 = 0 (u128 LE at offset 18, passive doesn't use it)
  // max_fill_abs = 1_000_000_000_000 (u128 LE at offset 34)
  const maxFill = 1_000_000_000_000n;
  for (let i = 0; i < 16; i++) {
    initMatcherData[34 + i] = Number((maxFill >> BigInt(i * 8)) & 0xFFn);
  }
  // max_inventory_abs = 0 (u128 LE at offset 50, no limit)

  const initMatcherTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    { programId: MATCHER_PROGRAM_ID, keys: [
      { pubkey: lpPda, isSigner: false, isWritable: false },
      { pubkey: matcherCtxPubkey, isSigner: false, isWritable: true },
    ], data: initMatcherData },
  );
  await sendAndConfirmTransaction(conn, initMatcherTx, [payer], { commitment: "confirmed" });
  console.log("Matcher context initialized (Passive, 50bps spread, 5bps fee)");

  // ========================================================================
  // STEP 2c: Init LP
  // ========================================================================
  console.log("\n--- Step 2c: Init LP ---\n");

  const initLpTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_INIT_LP, [
      payer.publicKey, SLAB_PUBKEY, adminAta.address, VAULT_PUBKEY, TOKEN_PROGRAM_ID,
    ]), data: encodeInitLP({ matcherProgram: MATCHER_PROGRAM_ID, matcherContext: matcherCtxPubkey, feePayment: "2000000" }) }),
  );
  await sendAndConfirmTransaction(conn, initLpTx, [payer], { commitment: "confirmed" });
  console.log(`LP created at index ${lpIndex}`);

  // ========================================================================
  // STEP 3: Deposit collateral to LP
  // ========================================================================
  console.log("\n--- Step 3: Fund LP ---\n");

  const depositTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
      payer.publicKey, SLAB_PUBKEY, adminAta.address, VAULT_PUBKEY, TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY,
    ]), data: encodeDepositCollateral({ userIdx: lpIndex, amount: LP_COLLATERAL.toString() }) }),
  );
  await sendAndConfirmTransaction(conn, depositTx, [payer], { commitment: "confirmed" });
  console.log(`LP funded: ${Number(LP_COLLATERAL) / 1e9} SOL`);

  // ========================================================================
  // STEP 4: Top up insurance
  // ========================================================================
  console.log("\n--- Step 4: Fund Insurance ---\n");

  const topupTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_TOPUP_INSURANCE, [
      payer.publicKey, SLAB_PUBKEY, adminAta.address, VAULT_PUBKEY, TOKEN_PROGRAM_ID,
    ]), data: encodeTopUpInsurance({ amount: INSURANCE_AMOUNT.toString() }) }),
  );
  await sendAndConfirmTransaction(conn, topupTx, [payer], { commitment: "confirmed" });
  console.log(`Insurance funded: ${Number(INSURANCE_AMOUNT) / 1e9} SOL`);

  // Verify pre-burn state
  const preBurnData = (await conn.getAccountInfo(SLAB_PUBKEY))!.data;
  const preBurnHeader = parseHeader(preBurnData);
  console.log(`\nPre-burn admin: ${preBurnHeader.admin.toBase58()}`);

  // ========================================================================
  // STEP 5: Burn admin
  // ========================================================================
  console.log("\n--- Step 5: Burn Admin ---\n");

  const burnIxData = encodeUpdateAdmin({ newAdmin: BURNED_ADMIN });
  const burnKeys = buildAccountMetas(ACCOUNTS_UPDATE_ADMIN, [
    payer.publicKey, SLAB_PUBKEY,
  ]);
  const burnTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: burnKeys, data: burnIxData }),
  );
  const burnSig = await sendAndConfirmTransaction(conn, burnTx, [payer], { commitment: "confirmed" });
  console.log(`Admin burned. tx: ${burnSig}`);

  // ========================================================================
  // STEP 6: Verify and print proof
  // ========================================================================
  console.log("\n--- Step 6: Proof of Immutability ---\n");

  const postBurnData = (await conn.getAccountInfo(SLAB_PUBKEY))!.data;
  const header = parseHeader(postBurnData);
  const config = parseConfig(postBurnData);
  const engine = parseEngine(postBurnData);
  const params = parseParams(postBurnData);

  const adminIsBurned = header.admin.equals(BURNED_ADMIN);

  console.log("ON-CHAIN STATE:");
  console.log(`  Slab:                  ${SLAB_PUBKEY.toBase58()}`);
  console.log(`  Admin:                 ${header.admin.toBase58()}`);
  console.log(`  Admin == SystemProgram: ${adminIsBurned}`);
  console.log(`  Oracle Authority:      ${config.oracleAuthority.toBase58()}`);
  console.log(`  Market Resolved:       ${header.resolved}`);
  console.log("");
  console.log("FROZEN PARAMETERS:");
  console.log(`  Trading Fee:           ${params.tradingFeeBps} bps`);
  console.log(`  Maintenance Margin:    ${params.maintenanceMarginBps} bps`);
  console.log(`  Initial Margin:        ${params.initialMarginBps} bps`);
  console.log(`  Liquidation Fee:       ${params.liquidationFeeBps} bps`);
  console.log(`  Max Crank Staleness:   ${params.maxCrankStalenessSlots} slots`);
  console.log("");
  console.log("INSURANCE FUND:");
  console.log(`  Balance:               ${engine.insuranceFund.balance}`);
  console.log(`  Fee Revenue:           ${engine.insuranceFund.feeRevenue}`);
  console.log(`  Withdrawable:          NO (admin burned)`);
  console.log("");

  if (adminIsBurned) {
    console.log("VERDICT: This market has no owner.\n");
    console.log("VERIFY YOURSELF:");
    console.log(`  solana account ${SLAB_PUBKEY.toBase58()} --url devnet --output json`);
    console.log("  Admin is bytes 16-48 of the slab. Should be all zeros (system program).");
  } else {
    console.log("ERROR: Admin burn failed.");
    process.exit(1);
  }

  // Save market info
  const [vaultPda] = deriveVaultAuthority(PROGRAM_ID, SLAB_PUBKEY);
  const marketInfo = {
    network: "devnet",
    createdAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
    slab: SLAB_PUBKEY.toBase58(),
    mint: NATIVE_MINT.toBase58(),
    vault: VAULT_PUBKEY.toBase58(),
    vaultPda: vaultPda.toBase58(),
    oracle: CHAINLINK_SOL_USD.toBase58(),
    inverted: true,
    adminBurned: true,
    admin: BURNED_ADMIN.toBase58(),
    burnTx: burnSig,
    lp: {
      index: lpIndex,
      pda: lpPda.toBase58(),
      matcherContext: matcherCtxPubkey.toBase58(),
    },
    insuranceFund: Number(INSURANCE_AMOUNT) / 1e9,
    frozenParams: {
      tradingFeeBps: Number(params.tradingFeeBps),
      maintenanceMarginBps: Number(params.maintenanceMarginBps),
      initialMarginBps: Number(params.initialMarginBps),
      liquidationFeeBps: Number(params.liquidationFeeBps),
      maxCrankStalenessSlots: Number(params.maxCrankStalenessSlots),
    },
  };
  fs.writeFileSync("devnet-market.json", JSON.stringify(marketInfo, null, 2));
  console.log("\nSaved to devnet-market.json");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
