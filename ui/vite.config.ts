import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@parsers": path.resolve(__dirname, "../src/solana"),
    },
  },
  define: {
    // @solana/web3.js needs Buffer and process in the browser
    "process.env": {},
    global: "globalThis",
  },
});
