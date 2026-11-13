#!/usr/bin/env bash
# Builds the giveaway program for this machine (not Solana), for tests. Needs clang 15 or newer.
# PHIL_LL may name a different copy of Phil's module (the mutation analysis uses this).
# Usage: giveaway/native/build.sh <out> [runtime.c]     (the burn vault passes burn/runtime.c)
set -euo pipefail
OUT="${1:-out/phil-draw-native}"
RUNTIME="${2:-giveaway/runtime.c}"
CLANG="$(command -v clang-18 || command -v clang)"
W="$(mktemp -d)"
"$CLANG" -O1 -std=c17 -Wall -Wextra -Werror -ffreestanding -fno-builtin -DPHIL_RUNTIME_FAULTS -c "$RUNTIME" -o "$W/runtime.o"
"$CLANG" -O1 -Wno-override-module -c "${PHIL_LL:-giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll}" -o "$W/phil.o"
"$CLANG" -O1 -Wno-override-module -c giveaway/shim.ll -o "$W/shim.o"
"$CLANG" -O1 -std=c17 -Wall -c giveaway/native/harness.c -o "$W/harness.o"
"$CLANG" "$W/harness.o" "$W/runtime.o" "$W/phil.o" "$W/shim.o" -o "$OUT"
