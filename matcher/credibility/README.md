# Credibility-Aware Matcher

A deterministic Solana program that adjusts trading spreads based on one signal: **insurance fund balance relative to open interest**.

Higher coverage → tighter spreads. Lower coverage → wider spreads. No other credibility input.

## Pricing logic

```
spread = min_spread_bps
spread += imbalance_k_bps * |inventory| / liquidity     (standard market-making)
spread -= insurance_weight_bps * min(insurance/OI, 1.0)  (credibility discount)
spread = clamp(spread, 1, max_spread_bps)

exec_price = oracle * (1 ± (spread + base_fee) / 10000)
```

The insurance coverage discount is the proof of concept: **time and solvency change market behavior**. As fees accumulate in the insurance fund and the ratio grows, spreads tighten automatically.

## Instructions

| Tag  | Name              | Accounts                              | Description                    |
|------|-------------------|---------------------------------------|--------------------------------|
| 0x00 | Match             | [lp_pda (signer), ctx (writable)]     | Price a trade (percolator CPI) |
| 0x02 | Init              | [lp_pda, ctx (writable)]              | Set up context with params     |
| 0x03 | UpdateCredibility | [ctx (writable), slab, clock]         | Refresh insurance/OI snapshot  |

`UpdateCredibility` is permissionless. Anyone can call it. No admin required.

## Building

Requires Rust and the Solana BPF toolchain (`cargo-build-sbf`). Install via `solana-install` or the Agave CLI.

```bash
cd matcher/credibility
cargo build-sbf
# Output: target/deploy/credibility_matcher.so
```

## Verified build

A verified build proves the deployed bytecode matches this source. Anyone can reproduce it.

```bash
# Install solana-verify (one-time)
cargo install solana-verify

# Build deterministically
cd matcher/credibility
solana-verify build

# The output hash can be compared against the deployed program
solana-verify get-program-hash <DEPLOYED_PROGRAM_ID> --url devnet
solana-verify get-executable-hash target/deploy/credibility_matcher.so
```

If both hashes match, the deployed program is exactly this source code. No trust required.

## Deploying (standard)

```bash
solana program deploy target/deploy/credibility_matcher.so --url devnet
```

## Deploying (immutable — burn upgrade authority)

This permanently prevents any future modification to the program. Irreversible.

```bash
# Deploy
solana program deploy target/deploy/credibility_matcher.so --url devnet

# Burn the upgrade authority (IRREVERSIBLE)
solana program set-upgrade-authority <PROGRAM_ID> --final --url devnet

# Verify it's burned
solana program show <PROGRAM_ID> --url devnet
# Authority should show: "none"
```

After burning, no entity can modify the program. The pricing logic is permanently locked to this source code.

## Full deploy script

```bash
npx tsx scripts/deploy-and-burn-matcher.ts
```

This script builds, deploys, burns the upgrade authority, and verifies in one step.

## Deploying an LP

```bash
npx tsx scripts/deploy-credibility-matcher.ts
npx tsx scripts/credibility-update-bot.ts 30
```
