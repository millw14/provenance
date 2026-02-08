# provenance

A perpetual market with no admin key, no governance, and no way to change its parameters after launch. Built on [Percolator](https://github.com/aeyakovenko/percolator-prog).

**Verify the claim:**

```bash
solana account <SLAB_PUBKEY> --url devnet --output json
# Bytes 16-48 are the admin key. After burn: all zeros (system program). No private key exists.
```

**What you can check on-chain:**
1. Admin key is the system program -- no entity can modify fees, risk params, or withdraw insurance.
2. Insurance fund grows with every trade and cannot be extracted.
3. Spreads tighten automatically as the insurance/OI ratio increases. [See the math.](matcher/credibility/src/lib.rs#L203-L241)

---

## Trust model

Hiding trust assumptions is worse than having them.

### What provenance controls (market level)

After `burn-admin`, the slab admin key (bytes 16-48) is set to the system program (`11111111111111111111111111111111`). No private key exists for this address. Every admin-gated instruction checks `accounts[0].is_signer` against this key and will fail.

- Fees: frozen
- Risk parameters: frozen
- Oracle sources: frozen
- Insurance fund: non-withdrawable
- Market: non-closeable

### What provenance does NOT control (program level)

The on-chain programs are **not part of this repository**. They are deployed by the Percolator team:

| Program | ID | Upgrade Authority | Immutable? |
|---|---|---|---|
| percolator-prog | `2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp` | `A3Mu2nQdjJXhJkuUDBbF2BdvgDs5KodNE9XsetXNMrCK` | **No** |
| percolator-match | `4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy` | `A3Mu2nQdjJXhJkuUDBbF2BdvgDs5KodNE9XsetXNMrCK` | **No** |

Both programs are upgradeable by a single keypair. A program upgrade could redefine what every instruction does, including ignoring the burned admin check.

The "adminless market" guarantee is **only as strong as the assumption that the underlying programs won't be maliciously upgraded**. For full trustlessness: verified builds, burned upgrade authority, or multisig.

```bash
# Verify yourself
solana program show 2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp --url devnet
```

## How to verify the market has no admin

The slab account stores all market state. The admin key is at **bytes 16-48**. After burn, these 32 bytes are the system program address.

```bash
# CLI
provenance verify-immutability --slab <SLAB_PUBKEY>

# RPC (no tools needed)
curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getAccountInfo",
  "params": ["<SLAB_PUBKEY>", {"encoding": "base64", "dataSlice": {"offset": 16, "length": 32}}]
}'
```

After burn: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=` (base64 of 32 zero bytes = system program).

### Instructions that are now dead code

| Tag | Instruction | What it would do |
|-----|-------------|------------------|
| 12 | `UpdateAdmin` | Transfer admin to another key |
| 14 | `UpdateConfig` | Change funding/threshold parameters |
| 11 | `SetRiskThreshold` | Change risk reduction threshold |
| 15 | `SetMaintenanceFee` | Change maintenance fee |
| 16 | `SetOracleAuthority` | Set oracle price authority |
| 18 | `SetOraclePriceCap` | Set oracle circuit breaker |
| 19 | `ResolveMarket` | Resolve a binary market |
| 13 | `CloseSlab` | Close the market account |
| 20 | `WithdrawInsurance` | Withdraw insurance fund |

### What still works

Trading, deposits, withdrawals, account creation, keeper cranks, liquidations, insurance top-ups. The market operates normally. It just can't be changed.

## Design

### Insurance fund: one-way accumulator

All trading fees flow into the insurance fund. Non-withdrawable after admin burn. Non-upgradeable. Usable only for liquidation shortfalls. Its growth is the market's primary credibility signal.

### One credibility signal drives pricing

The credibility-aware matcher uses a single input to adjust spreads: **insurance fund balance relative to open interest**.

- Higher coverage ratio (insurance / OI) -> tighter spreads
- Lower coverage ratio -> wider spreads

No compound scoring. No governance. One observable ratio, derived from on-chain state, that directly affects the cost of trading. If the market survives and fees accumulate, trading gets cheaper. Automatically.

### What Percolator handles (not modified)

Margin accounting, liquidation mechanics, keeper crank scheduling, oracle price ingestion, funding rate calculation, haircut ratio for socialized losses. This fork contributes **economic behavior** -- not protocol safety.

## Lifecycle

```bash
# One command: create market, fund LP and insurance, burn admin, print proof
npx tsx scripts/init-and-burn.ts
```

See [REPRODUCE.md](REPRODUCE.md) for the full step-by-step.

## CLI commands

| Command | Description |
|---|---|
| `burn-admin` | Transfer admin to system program (irreversible) |
| `verify-immutability` | Prove the market is adminless on-chain |
| `verify-program` | Check program upgrade authority and trust status |
| `insurance:status` | Current balance, fee revenue, growth metrics |
| `insurance:health` | Insurance vs open interest, coverage ratio |
| `insurance:history` | Snapshot: slot, fees, balance, OI (pipe to file for time series) |
| `credibility:status` | Market age, solvency streak, keeper activity |
| `prove-liveness` | Snapshot proving the market runs without intervention |

Standard percolator-cli commands (`init-market`, `init-user`, `deposit`, `withdraw`, `trade-cpi`, `trade-nocpi`, `keeper-crank`, `best-price`, `topup-insurance`, `slab:*`) are unchanged.

## Setup

```bash
npm install
npm run build
```

Configuration via `~/.config/percolator-cli.json` or flags: `--rpc <url>`, `--program <pubkey>`, `--wallet <path>`.

## Success criteria

> This market has no owner, no knobs, and no promises. Its only reputation is how long it has survived and how honestly it prices risk.

If the system needs emergency switches, governance votes, or manual rebalancing, it failed the design goal.

## Related repositories

- [percolator](https://github.com/aeyakovenko/percolator) -- Risk engine library
- [percolator-prog](https://github.com/aeyakovenko/percolator-prog) -- Solana program
- [percolator-match](https://github.com/aeyakovenko/percolator-match) -- Matcher program

Unaudited. Not for production use. Apache 2.0.
