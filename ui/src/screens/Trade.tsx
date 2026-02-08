import styles from "./Trade.module.css";

export function Trade() {
  return (
    <div className={styles.root}>
      <p className={styles.statement}>
        Trading interface intentionally omitted.
      </p>
      <p className={styles.detail}>
        This is an observatory, not a trading terminal. Use the CLI to trade.
      </p>
    </div>
  );
}
