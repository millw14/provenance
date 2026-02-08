import { InsuranceChart } from "../components/InsuranceChart";
import { StatCard } from "../components/StatCard";
import { lamportsToSol, coverageRatio } from "../lib/format";
import type { SlabSnapshot } from "../hooks/use-slab";
import styles from "./Insurance.module.css";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

interface InsuranceProps {
  data: SlabSnapshot;
  history: SlabSnapshot[];
}

export function Insurance({ data, history }: InsuranceProps) {
  const { header, engine } = data;

  const insuranceBal = engine.insuranceFund.balance;
  const feeRevenue = engine.insuranceFund.feeRevenue;
  const oi = engine.totalOpenInterest;
  const lossesAbsorbed = feeRevenue > insuranceBal ? feeRevenue - insuranceBal : 0n;
  const retentionPct =
    feeRevenue > 0n
      ? ((Number(insuranceBal) / Number(feeRevenue)) * 100).toFixed(1)
      : "N/A";
  const adminBurned = header.admin.toBase58() === SYSTEM_PROGRAM;

  return (
    <div className={styles.root}>
      <h2 className={styles.heading}>Insurance Accumulation</h2>
      <p className={styles.description}>
        All trading fees flow into the insurance fund. It cannot be withdrawn.
        The chart below builds over your browsing session.
      </p>

      <InsuranceChart history={history} />

      <div className={styles.grid}>
        <StatCard
          label="Current Balance"
          value={`${lamportsToSol(insuranceBal)} SOL`}
        />
        <StatCard
          label="Cumulative Fees"
          value={`${lamportsToSol(feeRevenue)} SOL`}
        />
        <StatCard
          label="Losses Absorbed"
          value={`${lamportsToSol(lossesAbsorbed)} SOL`}
        />
        <StatCard
          label="Retention"
          value={`${retentionPct}%`}
          sub="balance / fees collected"
        />
        <StatCard
          label="Coverage"
          value={coverageRatio(insuranceBal, oi)}
          sub="insurance / open interest"
        />
        <StatCard
          label="Vault"
          value={`${lamportsToSol(engine.vault)} SOL`}
        />
      </div>

      <div className={styles.footer}>
        <span className={styles.footerText}>
          Insurance fund cannot be withdrawn.{" "}
          {adminBurned
            ? "Admin key is burned."
            : "Admin key has not been burned yet."}
        </span>
      </div>
    </div>
  );
}
