import { Command } from "commander";
import { getGlobalFlags } from "../cli.js";
import { loadConfig } from "../config.js";
import { createContext } from "../runtime/context.js";
import { fetchSlab, parseEngine } from "../solana/slab.js";
import { validatePublicKey } from "../validation.js";

export function registerInsuranceHistory(program: Command): void {
  program
    .command("insurance:history")
    .description(
      "Print one-line insurance snapshot (slot, balance, fees, OI). Pipe to file for time series."
    )
    .requiredOption("--slab <pubkey>", "Slab account public key")
    .option("--header", "Print CSV header before data")
    .option("--loop <seconds>", "Repeat every N seconds")
    .action(async (opts, cmd) => {
      const flags = getGlobalFlags(cmd);
      const config = loadConfig(flags);
      const ctx = createContext(config);

      const slabPk = validatePublicKey(opts.slab, "--slab");

      const printSnapshot = async () => {
        const data = await fetchSlab(ctx.connection, slabPk);
        const engine = parseEngine(data);
        const slot = await ctx.connection.getSlot();

        const balance = engine.insuranceFund.balance;
        const feeRevenue = engine.insuranceFund.feeRevenue;
        const totalOI = engine.totalOpenInterest;
        const vault = engine.vault;
        const lossesAbsorbed =
          feeRevenue > balance ? feeRevenue - balance : 0n;

        if (flags.json) {
          console.log(
            JSON.stringify({
              slot,
              insurance_balance: balance.toString(),
              fee_revenue: feeRevenue.toString(),
              losses_absorbed: lossesAbsorbed.toString(),
              open_interest: totalOI.toString(),
              vault: vault.toString(),
            })
          );
        } else {
          console.log(
            `${slot}\t${balance}\t${feeRevenue}\t${lossesAbsorbed}\t${totalOI}\t${vault}`
          );
        }
      };

      if (opts.header && !flags.json) {
        console.log(
          "slot\tinsurance_balance\tfee_revenue\tlosses_absorbed\topen_interest\tvault"
        );
      }

      await printSnapshot();

      if (opts.loop) {
        const interval = parseInt(opts.loop, 10) * 1000;
        setInterval(async () => {
          try {
            await printSnapshot();
          } catch (err) {
            // Silently skip failed fetches in loop mode
          }
        }, interval);
      }
    });
}
