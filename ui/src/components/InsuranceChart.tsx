import styles from "./InsuranceChart.module.css";
import type { SlabSnapshot } from "../hooks/use-slab";

interface InsuranceChartProps {
  history: SlabSnapshot[];
}

const CHART_W = 900;
const CHART_H = 260;
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 30;

const INNER_W = CHART_W - PAD_L - PAD_R;
const INNER_H = CHART_H - PAD_T - PAD_B;

/**
 * Hand-built SVG line chart showing insurance balance over session time.
 * Data comes from in-memory history (lost on refresh -- intentional).
 */
export function InsuranceChart({ history }: InsuranceChartProps) {
  if (history.length < 2) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>
          Collecting data... chart appears after 2 samples
        </span>
      </div>
    );
  }

  const balances = history.map((s) => Number(s.engine.insuranceFund.balance));
  const times = history.map((s) => s.fetchedAt);

  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const range = maxBal - minBal || 1;

  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const timeRange = maxTime - minTime || 1;

  const points = history.map((s, i) => {
    const x = PAD_L + ((times[i] - minTime) / timeRange) * INNER_W;
    const y = PAD_T + INNER_H - ((balances[i] - minBal) / range) * INNER_H;
    return { x, y };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // Fill area under the line
  const areaD =
    pathD +
    ` L ${points[points.length - 1].x.toFixed(1)} ${PAD_T + INNER_H}` +
    ` L ${points[0].x.toFixed(1)} ${PAD_T + INNER_H} Z`;

  // Y-axis labels (3 ticks)
  const yTicks = [0, 0.5, 1].map((frac) => {
    const val = minBal + frac * range;
    const y = PAD_T + INNER_H - frac * INNER_H;
    // Display in SOL (lamports / 1e9)
    const label = (val / 1e9).toFixed(4);
    return { y, label };
  });

  // X-axis: first and last timestamp
  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={styles.container}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className={styles.svg}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* grid lines */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD_L}
            y1={t.y}
            x2={CHART_W - PAD_R}
            y2={t.y}
            stroke="#1a1a1a"
            strokeWidth="1"
          />
        ))}

        {/* Y labels */}
        {yTicks.map((t, i) => (
          <text
            key={i}
            x={PAD_L - 8}
            y={t.y + 4}
            textAnchor="end"
            className={styles.axisLabel}
          >
            {t.label}
          </text>
        ))}

        {/* X labels */}
        <text
          x={PAD_L}
          y={CHART_H - 4}
          textAnchor="start"
          className={styles.axisLabel}
        >
          {fmtTime(minTime)}
        </text>
        <text
          x={CHART_W - PAD_R}
          y={CHART_H - 4}
          textAnchor="end"
          className={styles.axisLabel}
        >
          {fmtTime(maxTime)}
        </text>

        {/* area fill */}
        <path d={areaD} fill="rgba(74, 222, 128, 0.06)" />

        {/* line */}
        <path
          d={pathD}
          fill="none"
          stroke="rgba(74, 222, 128, 0.5)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* latest point */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r="3"
          fill="rgba(74, 222, 128, 0.8)"
        />
      </svg>
    </div>
  );
}
