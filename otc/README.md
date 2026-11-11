# Phil OTC desk

`otc.phil` is a token swap through an escrow desk, written in Phil.

A maker locks tokens with the desk and names a price. A taker pays that price or walks away. The desk passes each coin on and keeps a fee of at most 10%.

**This is a simulation. No real tokens move.** Phil cannot deploy to a chain yet. The program runs in this repository's experimental simulator, which is our own reading of Phil and not the official implementation.

## What the program guarantees in the simulator

- `Token` and `Cash` are linear records, so a run that copies, keeps or drops one is rejected.
- The desk only settles a payment equal to the asking price (`Settle`).
- The fee is in basis points and capped at 1000, so the cut is never larger than the payment (`TakeFee`).
- Both protocols end on every path: filled, or refunded.

`npm run test:learn` runs both outcomes and a bounded bug hunt over boundary inputs, schedules and both taker choices. A bounded search is not a proof.

An earlier draft took a flat fee. The bug hunt found that a fee larger than the price broke `TakeFee`, which is why the fee is now a capped percentage.

## Try it

Open the OTC page of the site, or the "OTC desk" example in the playground.

## Roadmap

1. The swap, written and checked in Phil (done).
2. Partial fills, expiry and cancel.
3. An on-chain escrow that follows the same script, audited before it touches real tokens.
4. Wallets and listings.

After editing `otc.phil`, run `npm run gen:otc` (or `npm run build`) so the pages pick it up.
