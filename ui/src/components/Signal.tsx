import styles from "./Signal.module.css";

interface SignalProps {
  label: string;
  healthy: boolean;
  detail?: string;
}

export function Signal({ label, healthy, detail }: SignalProps) {
  return (
    <div className={styles.signal}>
      <span
        className={`${styles.dot} ${healthy ? styles.dotHealthy : styles.dotWarn}`}
      />
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
