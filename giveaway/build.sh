#!/usr/bin/env bash
# Builds the giveaway program for Solana from three parts:
#   Phil's emitted LLVM for its upload client and server (unmodified apart from the two lines
#   that name a desktop target), runtime.c, and shim.ll.
# Usage: giveaway/build.sh <out.so> [runtime.c]   (run from the repository root; the burn vault passes burn/runtime.c)
set -euo pipefail
OUT="$1"
RUNTIME="${2:-giveaway/runtime.c}"
PHIL_LL=giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll
find_clang() { find -L "$HOME/.cache/solana" "$HOME/.local/share/solana" -path '*llvm/bin/clang' -print -quit 2>/dev/null || true; }
CLANG="$(find_clang)"
if [ -z "$CLANG" ]; then cargo-build-sbf --install-only 2>&1 | tail -5 || true; CLANG="$(find_clang)"; fi
[ -n "$CLANG" ] || { echo "No SBF clang found"; exit 1; }
LLVM="$(dirname "$CLANG")"
"$CLANG" --version | head -1
W="$(mktemp -d)"
grep -v -E '^target (datalayout|triple) = ' "$PHIL_LL" > "$W/phil.ll"
HOISTED=false
if ! "$CLANG" -O2 -target sbf -fPIC -Wno-override-module -c "$W/phil.ll" -o "$W/phil.o" 2> "$W/phil.err"; then
  echo "Phil's module did not compile for Solana as it stands:"; head -5 "$W/phil.err"
  node giveaway/hoist.mjs "$W/phil.ll" "$W/phil.hoisted.ll"
  "$CLANG" -O2 -target sbf -fPIC -Wno-override-module -c "$W/phil.hoisted.ll" -o "$W/phil.o"
  HOISTED=true
fi
echo "stack slots moved to function tops: $HOISTED"
echo "$HOISTED" > "$(dirname "$OUT")/hoisted.txt"
"$CLANG" -Werror -O2 -fno-builtin -ffreestanding -std=c17 -target sbf -fPIC -c "$RUNTIME" -o "$W/runtime.o"
"$CLANG" -O2 -target sbf -fPIC -Wno-override-module -c giveaway/shim.ll -o "$W/shim.o"
"$LLVM/ld.lld" -z notext -shared --Bdynamic onchain/sbf.ld --entry entrypoint -o "$OUT" "$W/runtime.o" "$W/phil.o" "$W/shim.o"
ls -l "$OUT"
echo "undefined symbols (these must all be Solana's own calls):"
"$LLVM/llvm-nm" -u "$OUT" 2>/dev/null || "$LLVM/llvm-readelf" --dyn-syms "$OUT" | grep UND || true
