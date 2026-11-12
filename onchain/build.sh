#!/usr/bin/env bash
# Builds a Solana program from the LLVM that philc emitted, plus the small C entry point.
# Needs only Solana's compiler toolchain ("platform-tools": clang and lld with the SBF target).
# Usage: build.sh <phil.ll> <out.so>
set -euo pipefail
LL="$1"; OUT="$2"
find_clang() { find -L "$HOME/.cache/solana" "$HOME/.local/share/solana" -path '*llvm/bin/clang' -print -quit 2>/dev/null || true; }
CLANG="$(find_clang)"
if [ -z "$CLANG" ]; then
  echo "Fetching Solana's compiler toolchain"
  cargo-build-sbf --install-only 2>&1 | tail -5 || true
  CLANG="$(find_clang)"
fi
if [ -z "$CLANG" ]; then
  mkdir -p "$HOME/.cache/solana/manual" && cd "$HOME/.cache/solana/manual"
  gh release download -R anza-xyz/platform-tools -p 'platform-tools-linux-x86_64.tar.bz2' --clobber
  tar -xjf platform-tools-linux-x86_64.tar.bz2 && cd - >/dev/null
  CLANG="$(find_clang)"
fi
[ -n "$CLANG" ] || { echo "No SBF clang found"; ls -la "$HOME/.cache/solana" 2>/dev/null || true; cargo-build-sbf --help | head -40; exit 1; }
LLVM="$(dirname "$CLANG")"
echo "LLVM: $LLVM"; "$CLANG" --version | head -1
W="$(mktemp -d)"
"$CLANG" -Werror -O2 -fno-builtin -ffreestanding -std=c17 -target sbf -fPIC -c onchain/entry.c -o "$W/entry.o"
"$CLANG" -O2 -target sbf -fPIC -Wno-override-module -c "$LL" -o "$W/phil.o"
"$LLVM/ld.lld" -z notext -shared --Bdynamic onchain/sbf.ld --entry entrypoint -o "$OUT" "$W/entry.o" "$W/phil.o"
ls -l "$OUT"
"$LLVM/llvm-objdump" -d --no-show-raw-insn "$OUT" 2>/dev/null | sed -n '1,30p' || true
