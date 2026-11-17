#!/usr/bin/env bash
# Builds Phil's emitted upload server and chains/runtime.c as a flat RISC-V (rv64im) image.
# The same Phil module giveaway/build.sh compiles for Solana, compiled for a different machine.
# Usage: chains/build-riscv.sh <out.bin>     (run from the repository root; needs clang and lld 15 or newer)
set -euo pipefail
OUT="$1"
PHIL_LL=giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll
CLANG="$(command -v clang-18 || command -v clang)"
LLD="$(command -v ld.lld-18 || command -v ld.lld)"
OBJCOPY="$(command -v llvm-objcopy-18 || command -v llvm-objcopy)"
FLAGS="--target=riscv64-unknown-elf -march=rv64im -mabi=lp64 -mcmodel=medany -mno-relax -O2 -fno-pic"
W="$(mktemp -d)"
grep -v -E '^target (datalayout|triple) = ' "$PHIL_LL" > "$W/phil.ll"
"$CLANG" $FLAGS -Wno-override-module -c "$W/phil.ll" -o "$W/phil.o"
"$CLANG" $FLAGS -Wno-override-module -c giveaway/shim.ll -o "$W/shim.o"
"$CLANG" $FLAGS -Werror -Wall -Wextra -fno-builtin -ffreestanding -std=c17 -c chains/runtime.c -o "$W/runtime.o"
"$LLD" -T chains/riscv.ld --no-relax -static -o "$W/image.elf" "$W/runtime.o" "$W/phil.o" "$W/shim.o"
"$OBJCOPY" -O binary "$W/image.elf" "$OUT"
# The image must fit the interpreter's memory map: code and data below the upload's place, no leftover symbols.
END=$("$(dirname "$OBJCOPY")/$(basename "$OBJCOPY" | sed 's/objcopy/nm/')" "$W/image.elf" | awk '$3=="__bss_end"{print $1}')
echo "image: $(stat -c %s "$OUT") bytes, memory used up to 0x$END"
[ $((16#$END)) -lt $((0x18000)) ] || { echo "the image does not fit below 0x18000"; exit 1; }
