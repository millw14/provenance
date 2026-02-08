import { StatCard } from "../components/StatCard";
import { lamportsToSol, bpsToPercent } from "../lib/format";
import type { SlabSnapshot } from "../hooks/use-slab";
import styles from "./Risk.module.css";

interface RiskProps {
  data: SlabSnapshot;
}

// Matcher constants (from matcher/credibility/src/lib.rs)
const BASE_SPREAD_BPS = 30;
const INSURANCE_WEIGHT_BPS = 20;
const IMBALANCE_WEIGHT_BPS = 10;

export function Risk({ data }: RiskProps) {
  const { engine } = data;

  const oi = engine.totalOpenInterest;
  const netLp = engine.netLpPos;
  const insuranceBal = engine.insuranceFund.balance;
  const fundingRate = engine.fundingRateBpsPerSlotLast;

  // Imbalance computation: net LP position relative to OI
  const imbalancePct =
    oi > 0n ? (Number(netLp) / Number(oi)) * 100 : 0;

  // Spread decomposition (mirrors matcher logic)
  // Insurance discount: min(insurance / OI, 1.0) * weight
  const coverageRatio = oi > 0n ? Math.min(Number(insuranceBal) / Number(oi), 1.0) : 0;
  const insuranceDiscount = coverageRatio * INSURANCE_WEIGHT_BPS;

  // Imbalance penalty: |imbalance| * weight (simplified)
  const absImbalance = Math.abs(imbalancePct) / 100;
  const imbalancePenalty = Math.min(absImbalance, 1.0) * IMBALANCE_WEIGHT_BPS;

  const effectiveSpread = BASE_SPREAD_BPS + imbalancePenalty - insuranceDiscount;

  // Funding rate: bps per slot -> annualized
  const fundingPerDay = Number(fundingRate) * 216000; // slots/day
  const fundingPerYear = fundingPerDay * 365;

  // Imbalance bar visual
  const barWidth = Math.min(Math.abs(imbalancePct), 100);
  const isLong = imbalancePct > 0;

  return (
    <div className={styles.root}>
      <h2 className={styles.heading}>Risk & Pricing Intelligence</h2>

      {/* Section 1: Imbalance */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Net Imbalance</h3>
        <div className={styles.imbalanceBar}>
          <div className={styles.barTrack}>
            <div className={styles.barCenter} />
            <div
              className={`${styles.barFill} ${isLong ? styles.barLong : styles.barShort}`}
              style={{
                width: `${barWidth / 2}%`,
                [isLong ? "left" : "right"]: "50%",
              }}
            />
          </div>
          <div className={styles.barLabels}>
            <span>Short</span>
            <span className={styles.barValue}>
              {imbalancePct > 0 ? "+" : ""}
              {imbalancePct.toFixed(2)}%
            </span>
            <span>Long</span>
          </div>
        </div>
      </div>

      {/* Section 2: Funding */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Funding Rate</h3>
        <div className={styles.fundingGrid}>
          <StatCard
            label="Per slot"
            value={`${Number(fundingRate).toFixed(4)} bps`}
          />
          <StatCard
            label="Daily (est)"
            value={`${fundingPerDay.toFixed(2)} bps`}
          />
          <StatCard
            label="Annualized (est)"
            value={`${(fundingPerYear / 100).toFixed(2)}%`}
          />
        </div>
      </div>

      {/* Section 3: Spread Decomposition */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Spread Decomposition</h3>
        <p className={styles.description}>
          Shows how the credibility-aware matcher computes the effective spread.
        </p>
        <div className={styles.spreadTable}>
          <div className={styles.spreadRow}>
            <span className={styles.spreadLabel}>Base spread</span>
            <span className={styles.spreadValue}>{BASE_SPREAD_BPS} bps</span>
          </div>
          <div className={styles.spreadRow}>
            <span className={styles.spreadLabel}>
              + Imbalance penalty
            </span>
            <span className={styles.spreadValue}>
              {imbalancePenalty.toFixed(1)} bps
            </span>
          </div>
          <div className={styles.spreadRow}>
            <span className={styles.spreadLabel}>
              - Insurance discount
            </span>
            <span className={styles.spreadValueGreen}>
              -{insuranceDiscount.toFixed(1)} bps
            </span>
          </div>
          <div className={`${styles.spreadRow} ${styles.spreadRowTotal}`}>
            <span className={styles.spreadLabel}>= Effective spread</span>
            <span className={styles.spreadValue}>
              {effectiveSpread.toFixed(1)} bps
            </span>
          </div>
        </div>
        <p className={styles.note}>
          Higher insurance coverage reduces spreads. Higher imbalance increases
          them. This is deterministic, no human input.
        </p>
      </div>

      {/* Summary stats */}
      <div className={styles.grid}>
        <StatCard
          label="Open Interest"
          value={`${lamportsToSol(oi)} SOL`}
        />
        <StatCard
          label="Insurance"
          value={`${lamportsToSol(insuranceBal)} SOL`}
        />
        <StatCard
          label="Coverage Ratio"
          value={`${(coverageRatio * 100).toFixed(2)}%`}
        />
        <StatCard
          label="LP Sum Abs"
          value={lamportsToSol(engine.lpSumAbs)}
        />
      </div>
    </div>
  );
}
