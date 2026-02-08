import { Buffer } from "buffer";
// @solana/web3.js needs Buffer in the browser
(window as any).Buffer = Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
