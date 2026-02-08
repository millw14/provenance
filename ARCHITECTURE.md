# Architecture

```
provenance/
  src/              CLI (TypeScript)
  matcher/          On-chain program (Rust)
  ui/               Observatory (React)
  scripts/          Lifecycle automation
```

## src/

TypeScript CLI built on `commander`. Commands read and write on-chain state via `@solana/web3.js`. The `src/solana/slab.ts` parser is browser-safe and shared with the UI. All parsing is done client-side from raw account bytes -- no indexer, no backend.

## matcher/credibility/

One Solana program, 599 lines of Rust, one dependency (`solana-program`). Three instructions: Init, Match, UpdateCredibility. The pricing logic is at [`src/lib.rs` lines 203-241](matcher/credibility/src/lib.rs). It computes `spread = base + imbalance - insurance_discount`, where the insurance discount is `min(insurance/OI, 1.0) * weight`. That's the entire credibility mechanism.

## ui/

React + Vite observatory. Three screens: Overview (signals and stats), Insurance (SVG chart built over session), Risk (spread decomposition showing the math). Connects directly to an RPC endpoint, parses the slab client-side, polls every 5 seconds. No backend. No wallet connection on read-only screens.

## scripts/

`init-and-burn.ts` creates a market and burns the admin key in one sequence. `deploy-and-burn-matcher.ts` builds, deploys, and burns the upgrade authority of the credibility matcher. Both produce JSON files with addresses for subsequent verification.
