#!/usr/bin/env bash
# Builds Phil's emitted upload client for browsers: the same module the Solana programs are
# built from, compiled to WebAssembly with only UploadClient kept. It imports the sixteen client
# functions of Phil's runtime interface; site/src/phil-client.ts provides them.
# Needs clang and wasm-ld (15 or newer). Usage: giveaway/build-client.sh [out.wasm]
set -euo pipefail
OUT="${1:-giveaway/phil_client.wasm}"
CLANG="$(command -v clang-18 || command -v clang)"
LD="$(command -v wasm-ld-18 || command -v wasm-ld)"
W="$(mktemp -d)"
grep -v -E '^target (datalayout|triple) = ' giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll > "$W/phil.ll"
"$CLANG" --target=wasm32-unknown-unknown -O2 -ffunction-sections -Wno-override-module -c "$W/phil.ll" -o "$W/phil.o"
"$LD" --no-entry --export=UploadClient --gc-sections --allow-undefined --strip-all -o "$OUT" "$W/phil.o"
ls -l "$OUT"
