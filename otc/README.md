# Phil OTC desk

`otc.phil` is a token swap through an escrow desk, written in Phil.

A maker lists tokens with the desk at a price per token. Round by round a taker buys some, or passes. The listing ends when it sells out, when it expires after a set number of rounds, or when the maker cancels after a fill. The desk passes each coin on and keeps a fee of at most 10%.

**This is a simulation. No real tokens move.** Phil cannot deploy to a chain yet. The program runs in this repository's experimental simulator, which is our own reading of Phil and not the official implementation.

## What the program guarantees in the simulator

- `Token` and `Cash` are linear records, so a run that copies, keeps or drops one is rejected.
- The desk never hands out more tokens than the listing holds (`Carve`).
- The desk only settles a payment equal to the amount due (`Settle`).
- The fee is in basis points and capped at 1000, so the cut is never larger than the payment (`TakeFee`).
- A listing can only be retired when it is empty (`Retire`). Unsold tokens go back to the maker.
- Both protocols end on every path: sold out, expired, or cancelled.

`npm run test:learn` runs five outcomes (sold out, wallet runs dry, cancelled, expired part-filled, expired unfilled) and a bounded bug hunt over boundary inputs and schedules. A bounded search is not a proof.

An earlier draft took a flat fee. The bug hunt found that a fee larger than the price broke `TakeFee`, which is why the fee is now a capped percentage.

## Try it

Open the OTC page of the site, or the "OTC desk" example in the playground.

## Roadmap

1. The swap, written and checked in Phil (done).
2. Partial fills, expiry and cancel (done).
3. Several takers and several listings.
4. An on-chain escrow that follows the same script, audited before it touches real tokens.
5. Wallets and listings.

After editing `otc.phil`, run `npm run gen:otc` (or `npm run build`) so the pages pick it up.

## Limits of this version

One maker, one listing, one taker. Expiry is counted in rounds, not clock time, and is capped at 100 rounds. The maker can only cancel straight after a fill. Listings are capped at 1,000,000 tokens and a price of 1,000,000,000 per token so that no multiplication can overflow.
