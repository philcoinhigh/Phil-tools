# Same Phil, every chain

One program compiled from Phil, built for more than one chain from a single runtime file.

- `runtime.c` — the runtime Phil's emitted upload server calls. Built for Solana (SBF) and for RISC-V (rv64im) from this one file.
- `build-riscv.sh`, `riscv.ld` — build the flat RISC-V image. `giveaway/build.sh` builds the Solana program.
- `PhilRiscV.sol` — a RISC-V interpreter contract. It runs the image on any EVM chain, because Phil has no EVM backend.
- `evm.ts` — compiles the contract and runs it in a local Ethereum VM. `test/chains.ts` checks that the native build, the RISC-V image and the contract agree on every upload.
- `run.ts` — sends the same upload to real nodes. `networks.json` lists the EVM test networks.
- `site/src/rv64.ts` — the reference RISC-V machine, also used by the page.

The upload server is Phil's compiled code, unchanged. Everything in this folder is ours, is not Phil, and has not been audited. Test networks only.
