# Contract library

Token mechanics written in Phil. Each file is a complete program that runs in this repository's experimental simulator.

| File | What it is |
| --- | --- |
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
