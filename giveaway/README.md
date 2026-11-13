# Giveaways nobody can rig

A giveaway tool on Solana devnet. The entry list is locked on chain, a block that does not exist
yet picks the winner, and anyone can check the result without a wallet.

The program's decision-maker is Phil's: the `UploadServer` function that Phil's LLVM backend
emits (the `phil-llvm-phase0-control-codec` emitter in
[abiggerhammer/phil](https://github.com/abiggerhammer/phil)). It is the server side of Phil's
upload protocol: Hello, version, Begin, policy, exactly `Begin.length` bytes, SHA-256 check,
store, accepted or rejected.

| File | What it is |
|---|---|
| `phil-llvm/` | LLVM emitted by Phil's `phil-llvm-phase0-*` executables, unmodified. `emitted.json` says which Phil commit |
| `runtime.c` | The runtime Phil's server calls, written for Solana: frames from the instruction data, Solana's SHA-256, an account for storage. Also the `DRAW` instruction and the entry point |
| `shim.ll` | One function Phil declares as returning an LLVM pair, defined in LLVM so both sides agree |
| `hoist.mjs` | Moves Phil's stack-slot reservations to the top of each function. Solana's code generator needs this; nothing else in Phil's module is touched |
| `build.sh` | Builds the Solana program |
| `native/` | A harness that plays Solana on an ordinary machine, so the tests run anywhere with clang |
| `run.ts` | Runs a giveaway against a node: create account, lock, wait, draw, verify |
| `requests/`, `draws/` | Giveaways asked for, and their records |
| `program.json` | The deployed program |

## How a draw works

1. **Lock.** The giveaway record (title, winners, delay, and the list or its SHA-256) is sent
   through Phil's upload protocol, in the frame format of Phil's control codec v1. If
   `UploadServer` accepts, the runtime writes the record's digest, the list's digest and a target
   slot (`now + delay`) into a 256-byte account. The account can be locked once.
2. **Draw.** After the target slot, anyone may send `DRAW`. The program takes the hash of the
   first block at or after the target slot from Solana's `SlotHashes`, and sets
   `randomness = sha256(record digest, block hash, account address)`. Winner `j` is
   `sha256(randomness, j) mod entries`, skipping repeats. Solana keeps a block's hash for 512
   slots (about three minutes); a giveaway not drawn in that window is marked expired.
3. **Check.** `CHECK` runs an upload through Phil's server without writing anything and says
   whether it is the locked record. The website uses it through `simulateTransaction`, which
   needs no wallet.

## What it proves

That the list was fixed before the winning block existed, and that the winner follows from that
block. It does not prove the list is complete, and a draw that was not announced before its
result proves little, because draws can be repeated in private. The page says this too.

## What is and is not Phil

Phil: the protocol logic, which is `UploadServer` as Phil's backend emits it. Phil's own
interface checker (`scripts/check_runtime_abi.py` in Phil's repository) accepts `runtime.c`
against all 46 signatures Phil's module declares; the tests run it.

Not Phil: the runtime (`runtime.c`), the record format, and the draw. `UploadServer` is produced
by an emitter built into Phil's repository for Phil's own upload example; it is not compiled
from Phil source text by `philc`, which cannot build programs of this size yet.

## Running one

Maintainers: **Actions → Start a giveaway → Run workflow**, with a title and the entries.
That hands the request to `giveaway.yml` on the `onchain` branch, which is the only place the
devnet wallet can be read from (see `onchain/README.md`). Or add a file to `requests/` on the
`onchain` branch.

## Tests

`npm run test:giveaway` builds the program natively and runs lock, tamper, policy, check and
draw scenarios against it. The workflow repeats the important ones on a local Solana validator
and, after a deployment, on devnet.
