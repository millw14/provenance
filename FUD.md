# FUD Report: Honest threat model for Provenance

Self-audit. No spin. Every attack vector we know about, what we did about it, and what we can't fix.

---

## 1. Oracle price manipulation via thin reference liquidity

**Toly's question.** Valid.

### The attack

The Chainlink SOL/USD oracle (`99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR`) aggregates price from spot markets. If the reference spot market(s) have thin liquidity, an attacker can:

1. Push spot price down temporarily (e.g. dump on a thin order book)
2. Oracle picks up the manipulated price
3. Keeper crank updates the market with the bad price
4. Undercollateralized positions get liquidated at the wrong price
5. Attacker buys the liquidation proceeds cheaply
6. Spot price recovers, attacker profits

### What Percolator does about it

- **Crank staleness check**: trades and withdrawals are blocked if `currentSlot - lastCrankSlot > 200 slots` (~80 seconds). This limits the window of stale oracle exposure.
- **Oracle price cap** (`oraclePriceCapE2bps`): limits price change per oracle update. Currently 10% max per update on our devnet market. This is a circuit breaker.
- **Confidence filter** (`confFilterBps`): for Pyth oracles, rejects prices with wide confidence intervals. Our market uses Chainlink, where this doesn't apply.

### What it does NOT protect against

- **Gradual manipulation**: the price cap is *per-update*, not time-based. Rapid sequential pushes (each under 10%) can walk the price far.
- **Chainlink lag**: Chainlink aggregates on heartbeat intervals. A flash manipulation on the reference spot that persists for one heartbeat passes through.
- **Oracle authority mode**: if the market admin set an oracle authority before burning, that authority can push any price. On our market: admin is burned, so `SetOracleAuthority` is dead code. **But this only applies to our market instance.** Other markets on Percolator could have active oracle authorities.

### Honest assessment

Oracle manipulation is a systemic risk for **every** on-chain perp. Percolator's circuit breaker (10% cap) is better than nothing. Our credibility matcher doesn't make oracle risk worse or better -- it prices using the same oracle the program already validates. The risk is in Percolator's oracle integration, not in our matcher.

**What we can do**: nothing, at the protocol level. This requires Chainlink to have robust reference feeds. At the CLI level, we added validation that the oracle account passed to instructions is actually a Chainlink/Pyth account, not a random pubkey.

---

## 2. The Percolator programs are upgradeable

### The risk

| Program | Upgrade Authority |
|---|---|
| `percolator-prog` | `A3Mu2nQdjJXhJkuUDBbF2BdvgDs5KodNE9XsetXNMrCK` |
| `percolator-match` | `A3Mu2nQdjJXhJkuUDBbF2BdvgDs5KodNE9XsetXNMrCK` |

Both programs are upgradeable by a single keypair. A program upgrade could:
- Redefine what `burn-admin` means (make it a no-op)
- Bypass the admin check on every instruction
- Drain the vault
- Change liquidation logic

Our "adminless market" guarantee is **only as strong as the assumption that the underlying programs won't be maliciously upgraded.**

### Honest assessment

We don't control these programs. We documented this in the README trust model table. We verified our *own* matcher (`3Yg6brhpvLt7enU4rzvMkzexCexA1LFfAQqT3CSmGAH2`) with `solana-verify` and burned its upgrade authority. But the core risk engine -- that's Toly's.

**What we can do**: document it honestly (done). Verify builds if/when they're published. Monitor for upgrades.

---

## 3. Credibility snapshots can go stale

### The risk

Our matcher reads `insurance_snapshot` and `total_oi_snapshot` from its context account. These are only updated when someone calls instruction Tag 0x03 (`process_update_credibility`). If nobody calls it:

- The matcher prices spreads based on **old** insurance/OI data
- If insurance dropped (liquidation absorbed losses), spreads should widen but don't
- If OI grew, coverage ratio should decrease but doesn't
- Traders get artificially tight spreads that don't reflect current risk

### Mitigation

Tag 0x03 is **permissionless** -- anyone can call it. It reads directly from the slab (on-chain truth), not from caller input. But it requires someone to actually send the transaction.

### Honest assessment

This is a design trade-off, not a bug. On-chain programs can't auto-execute. The snapshot will lag behind reality by however long it takes for someone to refresh it. In practice: run a bot that calls Tag 0x03 before every crank cycle. On devnet with no traffic, staleness is irrelevant because nothing changes between updates anyway.

**What we can do**: document it. Add a CLI command to call Tag 0x03. Run a credibility refresh bot alongside the keeper.

---

## 4. Keeper is a single point of failure

### The risk

If the keeper stops cranking:
- Trades are blocked (crank staleness check fails)
- Liquidations don't process
- Funding rates don't update
- The market freezes

The keeper is **permissionless** -- anyone can run it. But if nobody does, the market is dead.

### Honest assessment

This is fundamental to Percolator's design. Every on-chain perp needs a keeper/crank mechanism. The Provenance design doesn't make this worse. The keeper requires no special keys -- it's just `keeper-crank --slab <pubkey> --oracle <oracle>`. Anyone with SOL for gas can run it.

**What we can do**: provide a reference keeper bot (already exists: `scripts/crank-bot.ts`). Document that liveness depends on keepers.

---

## 5. Insurance fund can be exhausted by a single gap event

### The risk

A large, sudden oracle price move (gap) can create liquidation losses that exceed the insurance fund. When this happens:

1. Insurance is drained to zero
2. The **haircut ratio** kicks in: `min(vault - cTot - insurance, pnlPosTot) / pnlPosTot`
3. Winning positions receive less than their full PnL on withdrawal
4. Losses are socialized across all winning traders

### Honest assessment

This is correct behavior. The insurance fund is finite. No mechanism can guarantee solvency under infinite adversarial conditions. The question is: does the market communicate this risk clearly?

Our answer: yes.
- `insurance:health` shows coverage ratio and grades it (STRONG / ADEQUATE / THIN / WEAK / CRITICAL)
- The credibility matcher **widens spreads** as coverage drops, making it more expensive to add risk when insurance is low
- The UI observatory shows insurance vs OI in real-time

**What we can do**: nothing more. This is the correct failure mode. The alternative (freezing withdrawals, governance bailouts) would break the design goal.

---

## 6. Zero-volume market makes credibility meaningless

### The risk

If nobody trades:
- OI is zero
- Insurance is just the initial topup
- The coverage ratio is undefined (division by zero, handled as 0)
- The credibility signal has no information content
- "Market has been running for X slots without deficit" means nothing if there's no risk to absorb

### Honest assessment

Credibility is earned through surviving *real* risk. A market with zero volume has zero credibility signal, which is correct. The spreads stay at `min_spread_bps` (50 bps) -- wide enough to not attract exploitation, narrow enough to not completely deter first traders.

The bootstrapping problem is real. Provenance doesn't solve it with incentives or subsidies. It solves it with time: if the market survives and volume eventually comes, credibility builds. If it doesn't, the market is just an empty slab.

**What we can do**: nothing. This is honest design.

---

## 7. PnL zombie accounts can collapse the haircut ratio

### The risk

Found in upstream `issue.md` (Finding K): an account with 0 capital, positive unrealized PnL, and a small open position becomes a "zombie" that:
- Cannot be liquidated (margin > 0 because of positive PnL)
- Cannot be closed (no capital for fees)
- Cannot be garbage-collected (has an open position)

Its unbounded positive PnL dominates `pnl_pos_tot`, which collapses the global haircut ratio toward zero. This means **all** winning traders get less than they should.

### Honest assessment

This is an upstream Percolator bug, not a Provenance bug. It affects the core risk engine. We documented it but can't fix it without modifying `percolator-prog` (which we don't control).

**What we can do**: document it. Monitor for zombie accounts via the CLI.

---

## 8. `init-lp` race condition (non-atomic matcher setup)

### The risk

The CLI `init-lp` command doesn't atomically create the matcher context and initialize the LP in the same transaction. Between these steps, an attacker could:
1. See the matcher context creation on-chain
2. Front-run the LP initialization with their own LP, binding the context to their LP PDA
3. The legitimate LP creator now has a context bound to the wrong LP

### Mitigation

Our deployment scripts (`wire-verified-matcher.ts`) explicitly handle this in separate transactions but use the correct LP index. The matcher context checks `existing_magic == MAGIC` to prevent re-initialization, so once initialized, it can't be hijacked.

### Honest assessment

This is a theoretical risk during initial setup, not during operation. In practice: on devnet with no adversary, this is academic. For mainnet deployment, the setup transactions should be made atomic (combine context creation + init + LP creation in one TX).

**What we can do**: documented the requirement. The CLI should add a compound transaction builder.

---

## 9. Default RPC defaulted to mainnet

### The risk (FIXED)

The upstream percolator-cli defaulted to `https://api.mainnet-beta.solana.com` when no config file existed. A user who forgot `--rpc` would execute commands on mainnet.

### Fix

Changed default to `https://api.devnet.solana.com` in our fork. Also fixed the Solana Explorer link in transaction output to detect network and append `?cluster=devnet` when appropriate.

---

## 10. Oracle account bug in withdraw/close scripts

### The risk (FIXED)

The upstream percolator-cli used `config.indexFeedId` (a Pyth feed ID hash -- 32 bytes of data, not a Solana account) as the oracle account in withdraw, close-account, and trade-cpi commands. This was also present in 5 test scripts.

If the 32-byte feed ID hash happened to correspond to a real account, the program would use incorrect price data. More likely: the transaction would simply fail with an unhelpful error.

### Fix

- Previously fixed in `src/commands/` (withdraw.ts, close-account.ts, trade-cpi.ts) by adding `--oracle <pubkey>` as a required CLI option
- Now fixed in 5 scripts: `test-price-profit.ts`, `stress-worst-case.ts`, `stress-corner-cases.ts`, `test-profitable-withdrawal.ts`, `test-profit-withdrawal.ts`

---

## Summary: what's real, what's fixed, what's inherent

| # | Issue | Severity | Status | Who can fix |
|---|-------|----------|--------|-------------|
| 1 | Oracle manipulation via thin liquidity | HIGH | Inherent | Chainlink / protocol design |
| 2 | Percolator programs upgradeable | HIGH | Documented | Toly (burn authority) |
| 3 | Credibility snapshots can go stale | MEDIUM | Documented | Run refresh bot |
| 4 | Keeper single point of failure | MEDIUM | Inherent | Anyone (permissionless crank) |
| 5 | Insurance exhaustion on gap event | MEDIUM | By design | No one (correct failure mode) |
| 6 | Zero volume = zero credibility | LOW | By design | Time and adoption |
| 7 | PnL zombie accounts | HIGH | Upstream bug | Percolator team |
| 8 | Non-atomic LP setup | LOW | Documented | Compound TX builder |
| 9 | Default RPC = mainnet | CRITICAL | **Fixed** | Us (this fork) |
| 10 | Oracle account bug in scripts | CRITICAL | **Fixed** | Us (this fork) |

### What Toly should hear

"We found real bugs in the upstream CLI (oracle account confusion, mainnet default) and fixed them. The protocol-level risks (oracle manipulation, program upgradeability, keeper dependency) are inherent to on-chain perps and Percolator's architecture. We documented all of them honestly instead of pretending they don't exist."
