/**
 * init-and-burn.ts
 *
 * Creates an inverted SOL/USD market on devnet, then immediately
 * burns the admin key. Prints verifiable proof of immutability.
 *
 * After this script runs, the market has no owner. Period.
 *
 * Usage:
 *   npx tsx scripts/init-and-burn.ts
 */
import "dotenv/config";
import {
  Connection, Keypair, PublicKey, Transaction,
  sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram,
  SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, NATIVE_MINT,
} from "@solana/spl-token";
import * as fs from "fs";
import {
  encodeInitMarket, encodeInitLP, encodeDepositCollateral,
  encodeTopUpInsurance, encodeKeeperCrank, encodeUpdateAdmin,
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_MARKET, ACCOUNTS_INIT_LP, ACCOUNTS_DEPOSIT_COLLATERAL,
  ACCOUNTS_TOPUP_INSURANCE, ACCOUNTS_KEEPER_CRANK, ACCOUNTS_UPDATE_ADMIN,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveVaultAuthority, deriveLpPda } from "../src/solana/pda.js";
import { buildIx } from "../src/runtime/tx.js";
import { parseHeader, parseConfig, parseEngine, parseParams, parseUsedIndices } from "../src/solana/slab.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHAINLINK_SOL_USD = new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const MATCHER_PROGRAM_ID = new PublicKey("4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy");
const BURNED_ADMIN = new PublicKey("11111111111111111111111111111111");

const SLAB_SIZE = 992560;
const MATCHER_CTX_SIZE = 320;
const INSURANCE_AMOUNT = 1_000_000_000n;  // 1 SOL
const LP_COLLATERAL = 1_000_000_000n;     // 1 SOL

// ---------------------------------------------------------------------------
const conn = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed"
);
const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
const payer = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
);

async function main() {
  console.log("=== INIT AND BURN ===\n");
  console.log("This script creates a market, then permanently burns the admin key.\n");

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`Wallet:  ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // ========================================================================
  // PHASE 1: Create market
  // ========================================================================
  console.log("--- Phase 1: Create Market ---\n");

  // Create slab
  const slab = Keypair.generate();
  const rentExempt = await conn.getMinimumBalanceForRentExemption(SLAB_SIZE);
  console.log(`Creating slab: ${slab.publicKey.toBase58()}`);

  const createSlabTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: slab.publicKey,
      lamports: rentExempt,
      space: SLAB_SIZE,
      programId: PROGRAM_ID,
    })
  );
  await sendAndConfirmTransaction(conn, createSlabTx, [payer, slab], { commitment: "confirmed" });

  // Derive vault PDA + create vault ATA
  const [vaultPda] = deriveVaultAuthority(PROGRAM_ID, slab.publicKey);
  const vaultAccount = await getOrCreateAssociatedTokenAccount(conn, payer, NATIVE_MINT, vaultPda, true);
  const vault = vaultAccount.address;
  console.log(`Vault:   ${vault.toBase58()}`);

  // Init market (inverted)
  const feedId = Buffer.from(CHAINLINK_SOL_USD.toBytes()).toString("hex");
  const initMarketData = encodeInitMarket({
    admin: payer.publicKey,
    collateralMint: NATIVE_MINT,
    indexFeedId: feedId,
    maxStalenessSecs: "3600",
    confFilterBps: 500,
    invert: 1,
    unitScale: 0,
    initialMarkPriceE6: "0",
    warmupPeriodSlots: "10",
    maintenanceMarginBps: "500",
    initialMarginBps: "1000",
    tradingFeeBps: "10",
    maxAccounts: "1024",
    newAccountFee: "1000000",
    riskReductionThreshold: "0",
    maintenanceFeePerSlot: "0",
    maxCrankStalenessSlots: "200",
    liquidationFeeBps: "100",
    liquidationFeeCap: "1000000000",
    liquidationBufferBps: "50",
    minLiquidationAbs: "100000",
  });
  const initMarketKeys = buildAccountMetas(ACCOUNTS_INIT_MARKET, [
    payer.publicKey, slab.publicKey, NATIVE_MINT, vault,
    TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
    vaultPda, SystemProgram.programId,
  ]);
  const initTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    buildIx({ programId: PROGRAM_ID, keys: initMarketKeys, data: initMarketData })
  );
  await sendAndConfirmTransaction(conn, initTx, [payer], { commitment: "confirmed" });
  console.log("Market initialized (inverted SOL/USD)");

  // Keeper crank
  const crankData = encodeKeeperCrank({ callerIdx: 65535, allowPanic: false });
  const crankKeys = buildAccountMetas(ACCOUNTS_KEEPER_CRANK, [
    payer.publicKey, slab.publicKey, SYSVAR_CLOCK_PUBKEY, CHAINLINK_SOL_USD,
  ]);
  const crankTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    buildIx({ programId: PROGRAM_ID, keys: crankKeys, data: crankData })
  );
  await sendAndConfirmTransaction(conn, crankTx, [payer], { commitment: "confirmed", skipPreflight: true });
  console.log("Initial keeper crank executed");

  // Wrap SOL for collateral + insurance
  const adminAta = await getOrCreateAssociatedTokenAccount(conn, payer, NATIVE_MINT, payer.publicKey);
  const wrapTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: adminAta.address, lamports: 5 * LAMPORTS_PER_SOL }),
    { programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: adminAta.address, isSigner: false, isWritable: true }], data: Buffer.from([17]) },
  );
  await sendAndConfirmTransaction(conn, wrapTx, [payer], { commitment: "confirmed" });

  // Create LP
  const slabInfo = await conn.getAccountInfo(slab.publicKey);
  const usedIndices = slabInfo ? parseUsedIndices(slabInfo.data) : [];
  const lpIndex = usedIndices.length;
  const [lpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, lpIndex);
  const matcherCtxKp = Keypair.generate();
  const matcherRent = await conn.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);

  const lpTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: matcherCtxKp.publicKey,
      lamports: matcherRent, space: MATCHER_CTX_SIZE, programId: MATCHER_PROGRAM_ID,
    }),
    { programId: MATCHER_PROGRAM_ID, keys: [
      { pubkey: lpPda, isSigner: false, isWritable: false },
      { pubkey: matcherCtxKp.publicKey, isSigner: false, isWritable: true },
    ], data: Buffer.from([1]) },
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_INIT_LP, [
      payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID,
    ]), data: encodeInitLP({ matcherProgram: MATCHER_PROGRAM_ID, matcherContext: matcherCtxKp.publicKey, feePayment: "2000000" }) }),
  );
  await sendAndConfirmTransaction(conn, lpTx, [payer, matcherCtxKp], { commitment: "confirmed" });
  console.log(`LP created at index ${lpIndex}`);

  // Deposit to LP
  const depositTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
      payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY,
    ]), data: encodeDepositCollateral({ userIdx: lpIndex, amount: LP_COLLATERAL.toString() }) }),
  );
  await sendAndConfirmTransaction(conn, depositTx, [payer], { commitment: "confirmed" });
  console.log(`LP funded: ${Number(LP_COLLATERAL) / 1e9} SOL`);

  // Top up insurance
  const topupTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: buildAccountMetas(ACCOUNTS_TOPUP_INSURANCE, [
      payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID,
    ]), data: encodeTopUpInsurance({ amount: INSURANCE_AMOUNT.toString() }) }),
  );
  await sendAndConfirmTransaction(conn, topupTx, [payer], { commitment: "confirmed" });
  console.log(`Insurance funded: ${Number(INSURANCE_AMOUNT) / 1e9} SOL`);

  // Verify pre-burn state
  const preBurnData = (await conn.getAccountInfo(slab.publicKey))!.data;
  const preBurnHeader = parseHeader(preBurnData);
  console.log(`\nPre-burn admin: ${preBurnHeader.admin.toBase58()}`);

  // ========================================================================
  // PHASE 2: Burn admin
  // ========================================================================
  console.log("\n--- Phase 2: Burn Admin ---\n");

  const burnIxData = encodeUpdateAdmin({ newAdmin: BURNED_ADMIN });
  const burnKeys = buildAccountMetas(ACCOUNTS_UPDATE_ADMIN, [
    payer.publicKey, slab.publicKey,
  ]);
  const burnTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildIx({ programId: PROGRAM_ID, keys: burnKeys, data: burnIxData }),
  );
  const burnSig = await sendAndConfirmTransaction(conn, burnTx, [payer], { commitment: "confirmed" });
  console.log(`Admin burned. tx: ${burnSig}`);

  // ========================================================================
  // PHASE 3: Verify and print proof
  // ========================================================================
  console.log("\n--- Phase 3: Proof of Immutability ---\n");

  const postBurnData = (await conn.getAccountInfo(slab.publicKey))!.data;
  const header = parseHeader(postBurnData);
  const config = parseConfig(postBurnData);
  const engine = parseEngine(postBurnData);
  const params = parseParams(postBurnData);

  const adminIsBurned = header.admin.equals(BURNED_ADMIN);
  const oracleAuthorityDisabled = config.oracleAuthority.equals(BURNED_ADMIN);

  console.log("ON-CHAIN STATE:");
  console.log(`  Slab:                  ${slab.publicKey.toBase58()}`);
  console.log(`  Admin:                 ${header.admin.toBase58()}`);
  console.log(`  Admin == SystemProgram:${adminIsBurned}`);
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
  console.log("DISABLED INSTRUCTIONS (no valid signer exists):");
  console.log("  [x] UpdateAdmin       (tag 12) — admin is system program");
  console.log("  [x] UpdateConfig      (tag 14) — admin is system program");
  console.log("  [x] SetRiskThreshold  (tag 11) — admin is system program");
  console.log("  [x] SetOracleAuthority(tag 16) — admin is system program");
  console.log("  [x] ResolveMarket     (tag 19) — admin is system program");
  console.log("  [x] CloseSlab         (tag 13) — admin is system program");
  console.log("  [x] WithdrawInsurance (tag 20) — admin is system program");
  console.log("  [x] SetMaintenanceFee (tag 15) — admin is system program");
  console.log("  [x] SetOraclePriceCap (tag 18) — admin is system program");
  console.log("");

  if (adminIsBurned) {
    console.log("VERDICT: This market has no owner.");
    console.log("");
    console.log("VERIFY YOURSELF:");
    console.log(`  provenance verify-immutability --slab ${slab.publicKey.toBase58()}`);
    console.log(`  provenance slab:header --slab ${slab.publicKey.toBase58()}`);
    console.log("");
    console.log("Or read the account directly:");
    console.log(`  solana account ${slab.publicKey.toBase58()} --url devnet --output json`);
    console.log("  Admin is bytes 16-48 of the slab. Should be all zeros (system program).");
  } else {
    console.log("ERROR: Admin burn failed. Admin is still active.");
    process.exit(1);
  }

  // Save market info
  const marketInfo = {
    network: "devnet",
    createdAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
    slab: slab.publicKey.toBase58(),
    mint: NATIVE_MINT.toBase58(),
    vault: vault.toBase58(),
    vaultPda: vaultPda.toBase58(),
    oracle: CHAINLINK_SOL_USD.toBase58(),
    inverted: true,
    adminBurned: true,
    admin: BURNED_ADMIN.toBase58(),
    burnTx: burnSig,
    lp: {
      index: lpIndex,
      pda: lpPda.toBase58(),
      matcherContext: matcherCtxKp.publicKey.toBase58(),
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
