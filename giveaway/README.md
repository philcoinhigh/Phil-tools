# Provably fair giveaways (work in progress)

Building blocks for a giveaway tool whose accept-or-reject decision is made on Solana by the
LLVM that Phil's backend emits for its upload server.

`phil-llvm/` holds that LLVM, emitted by the `phil-llvm-phase0-*` executables in
[abiggerhammer/phil](https://github.com/abiggerhammer/phil), unmodified. `emitted.json` records
which Phil commit produced it.
