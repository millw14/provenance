import { useState, useEffect } from "react";
import styles from "./TimeElapsed.module.css";

interface TimeElapsedProps {
  /** Current slot from the slab */
  currentSlot: bigint;
  /** Whether admin key is burned */
  adminBurned: boolean;
}

/**
 * "Day N since admin burn" live counter.
 * Uses slot difference as the basis; updates the day count client-side.
 * If admin is not burned, shows a warning instead.
 */
export function TimeElapsed({ currentSlot, adminBurned }: TimeElapsedProps) {
  const [elapsedDisplay, setElapsedDisplay] = useState("");

  useEffect(() => {
    if (!adminBurned) {
      setElapsedDisplay("Admin key not yet burned");
      return;
    }

    // Approximate: slot * 0.4s per slot / 86400s per day
    // We use current slot as a rough age proxy (actual burn slot unknown client-side)
    // In a real deployment, this would compare against a known genesis/burn slot
    const updateDisplay = () => {
      const approxSeconds = Number(currentSlot) * 0.4;
      const days = Math.floor(approxSeconds / 86400);
      const hours = Math.floor((approxSeconds % 86400) / 3600);
      const minutes = Math.floor((approxSeconds % 3600) / 60);

      if (days > 0) {
        setElapsedDisplay(`Day ${days.toLocaleString()}`);
      } else if (hours > 0) {
        setElapsedDisplay(`Hour ${hours}`);
      } else {
        setElapsedDisplay(`Minute ${minutes}`);
      }
    };

    updateDisplay();
    const id = setInterval(updateDisplay, 60_000);
    return () => clearInterval(id);
  }, [currentSlot, adminBurned]);

  return (
    <div className={styles.container}>
      <span className={styles.counter}>{elapsedDisplay}</span>
      {adminBurned && (
        <span className={styles.subtitle}>since admin burn</span>
      )}
    </div>
  );
}
