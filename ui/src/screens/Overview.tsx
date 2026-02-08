import { TimeElapsed } from "../components/TimeElapsed";
import { StatCard } from "../components/StatCard";
import { Signal } from "../components/Signal";
import { lamportsToSol, bpsToPercent, coverageRatio, slotsToHumanDuration, shortAddr } from "../lib/format";
import type { SlabSnapshot } from "../hooks/use-slab";
import { useProgramTrust } from "../hooks/use-program-trust";
import styles from "./Overview.module.css";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const PERCOLATOR_PROG = "2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp";
const PERCOLATOR_MATCH = "4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy";

interface OverviewProps {
  data: SlabSnapshot;
  rpcUrl: string;
}

export function Overview({ data, rpcUrl }: OverviewProps) {
  const { header, engine, params } = data;
  const { programs } = useProgramTrust(rpcUrl, [PERCOLATOR_PROG, PERCOLATOR_MATCH]);

  const adminBurned = header.admin.toBase58() === SYSTEM_PROGRAM;
  const insuranceBal = engine.insuranceFund.balance;
  const feeRevenue = engine.insuranceFund.feeRevenue;
  const oi = engine.totalOpenInterest;
  const keeperStaleness =
    engine.currentSlot > engine.lastCrankSlot
      ? engine.currentSlot - engine.lastCrankSlot
      : 0n;
  const keeperFresh =
    keeperStaleness < engine.maxCrankStalenessSlots;
  const haircutSafe = engine.pnlPosTot <= engine.cTot;
  const lossesAbsorbed = feeRevenue > insuranceBal ? feeRevenue - insuranceBal : 0n;

  return (
    <div className={styles.root}>
      <TimeElapsed currentSlot={engine.currentSlot} adminBurned={adminBurned} />

      <div className={styles.grid}>
        <StatCard
          label="Insurance"
          value={`${lamportsToSol(insuranceBal)} SOL`}
          sub={`${lamportsToSol(feeRevenue)} cumulative fees`}
        />
        <StatCard
          label="Coverage"
          value={coverageRatio(insuranceBal, oi)}
          sub="insurance / open interest"
        />
        <StatCard
          label="Open Interest"
          value={`${lamportsToSol(oi)} SOL`}
        />
        <StatCard
          label="Vault"
          value={`${lamportsToSol(engine.vault)} SOL`}
        />
        <StatCard
          label="Trading Fee"
          value={bpsToPercent(params.tradingFeeBps)}
          sub="frozen parameter"
        />
        <StatCard
          label="Liquidations"
          value={engine.lifetimeLiquidations.toString()}
          sub={`${engine.lifetimeForceCloses.toString()} force closes`}
        />
        <StatCard
          label="Accounts"
          value={engine.numUsedAccounts.toString()}
          sub={`of ${params.maxAccounts.toString()} max`}
        />
        <StatCard
          label="Losses Absorbed"
          value={`${lamportsToSol(lossesAbsorbed)} SOL`}
          sub="by insurance fund"
        />
      </div>

      <div className={styles.signals}>
        <h3 className={styles.signalTitle}>Credibility Signals</h3>
        <Signal
          label="Admin key burned"
          healthy={adminBurned}
          detail={adminBurned ? SYSTEM_PROGRAM.slice(0, 8) + "..." : header.admin.toBase58().slice(0, 8) + "..."}
        />
        <Signal
          label="Keeper active"
          healthy={keeperFresh}
          detail={`${slotsToHumanDuration(keeperStaleness)} since last crank`}
        />
        <Signal
          label="No insolvency events"
          healthy={haircutSafe}
          detail={haircutSafe ? "pnl < capital" : "haircut condition active"}
        />
        <Signal
          label="Insurance growing"
          healthy={insuranceBal > 0n}
          detail={feeRevenue > 0n ? `${((Number(insuranceBal) / Number(feeRevenue)) * 100).toFixed(1)}% retained` : "no fees yet"}
        />
        <Signal
          label="Market resolved"
          healthy={!header.resolved}
          detail={header.resolved ? "market resolved" : "active"}
        />
      </div>

      <div className={styles.signals}>
        <h3 className={styles.signalTitle}>Program Trust</h3>
        {programs.length === 0 && (
          <span className={styles.loading}>Checking program authorities...</span>
        )}
        {programs.map((p) => (
          <Signal
            key={p.programId}
            label={`${p.programId === PERCOLATOR_PROG ? "Risk engine" : "Matcher"} ${p.upgradeable ? "upgradeable" : "immutable"}`}
            healthy={!p.upgradeable}
            detail={
              p.upgradeable
                ? `authority: ${p.upgradeAuthority ? shortAddr(p.upgradeAuthority) : "unknown"}`
                : "upgrade authority burned"
            }
          />
        ))}
        {programs.some((p) => p.upgradeable) && (
          <p className={styles.trustNote}>
            Market-level immutability depends on these programs not being modified.
            Upgrade authorities should be burned or set to a multisig for full trustlessness.
          </p>
        )}
      </div>
    </div>
  );
}
