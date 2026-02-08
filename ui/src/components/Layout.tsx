import { type ReactNode } from "react";
import styles from "./Layout.module.css";

export type Screen = "overview" | "insurance" | "risk" | "trade";

const NAV_ITEMS: { id: Screen; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "insurance", label: "Insurance" },
  { id: "risk", label: "Risk" },
  { id: "trade", label: "Trade" },
];

interface LayoutProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

export function Layout({ activeScreen, onNavigate, children }: LayoutProps) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.title}>provenance</span>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`${styles.navItem} ${
                activeScreen === item.id ? styles.navItemActive : ""
              }`}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
