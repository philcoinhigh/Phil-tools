# Token utilities

The tools token projects use every day, written in Phil. Each file is a complete program that runs in this repository's experimental simulator.

| File | What it is |
| --- | --- |
| `locker.phil` | A token locker: cliff, a release every period, claim on demand, optional cancel by the sender |
| `hooks.phil` | Transfer hooks: a limit hook that allows or blocks a transfer, and a fee hook that takes custody and keeps a capped cut |
| `launchhooks.phil` | Launchpad hooks: a sniper hook and a fee hook on every buy, holder rewards, and a graduation hook that burns and locks liquidity and schedules the creator's tokens. Modelled on higher.fun's public docs; not their code |
| `stockrewards.phil` | Stock rewards hook: buys tokenized stock with the holders' share of fees, under a price limit, and hands it out by tokens held |
| `vesting.phil` | A grant released in equal parts per period, revocable by the grantor |
| `multisig.phil` | A 2-of-3 treasury: three signers vote on one payment |
| `auction.phil` | A sealed-bid auction with a reserve price and two bidders |
| `launch.phil` | A bonding-curve launch that graduates into a liquidity pool or refunds in full |

The OTC desk and order book are in [`otc/`](../otc).

**These are simulations. No real tokens move.** Phil cannot deploy to a chain yet, and the simulator is our own reading of Phil, not the official implementation.

## How they are checked

`core/src/sim/contracts.ts` lists each contract with its guarantees, input fields and named scenarios. `npm run test:learn` runs every scenario and checks what it prints, then runs a bounded bug hunt over boundary inputs and schedules. A bounded search is not a proof.

## The pattern they share

- Anything of value is a `mode linear` record, so a run that copies, keeps or drops it is rejected.
- Every rule about value is a `callable` with `requires` clauses, and value only moves through those functions.
- Each relationship between two parties is a `protocol` whose every branch ends, so no path leaves someone waiting.
- Inputs that feed multiplication carry refinement bounds, so arithmetic cannot overflow.

After editing a file here, run `npm run gen:otc` (or `npm run build`) so the pages pick it up.

## Forking these for a real chain

These are written to be forked once Phil can deploy on chain, and to serve as a specification before then. Each entry in `core/src/sim/contracts.ts` has a `port` list: what an on-chain version needs that the program does not model. In general:

- **Time.** Periods are counted steps. On chain they come from the clock.
- **Custody.** A component that holds a linear `Token` becomes a program-owned account.
- **Authority.** Who may do what is fixed here by which program holds which end of a protocol. On chain it is checked by signature.
- **Fixed wiring.** A Phil architecture is wired up before it runs, so the number of parties is fixed. A real service handles any number of locks or transfers.

What carries over unchanged is the part that matters: the protocols (every step and every ending for each party) and the written rules about value.
