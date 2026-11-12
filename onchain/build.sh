#!/usr/bin/env bash
# Builds a Solana program from the LLVM that philc emitted, plus the small C entry point.
# Uses the C toolchain that ships with the Solana SDK. Usage: build.sh <phil.ll> <out.so>
set -euo pipefail
LL="$1"; OUT="$2"
BIN="$(dirname "$(command -v cargo-build-sbf)")"
SDK="$(dirname "$(find -L "$BIN" -name sbf.mk -print -quit)")/.."
SDK="$(cd "$SDK" && pwd)"
echo "SDK: $SDK"
[ -x "$SDK/scripts/install.sh" ] && "$SDK/scripts/install.sh"
LLVM="$SDK/dependencies/platform-tools/llvm/bin"
[ -x "$LLVM/clang" ] || LLVM="$(dirname "$(find -L "$HOME/.cache/solana" -path '*platform-tools/llvm/bin/clang' -print -quit)")"
echo "LLVM: $LLVM"; "$LLVM/clang" --version | head -1
echo "--- how the SDK itself compiles and links C programs:"; grep -nE "SBF_C_FLAGS|SBF_LLD_FLAGS|TARGET|sbf.ld|-target|march|mcpu" "$SDK/c/sbf.mk" | head -30 || true
INC=(); for d in "$SDK/c/inc" "$SDK/dependencies/platform-tools/llvm/lib/clang"/*/include; do [ -d "$d" ] && INC+=("-isystem$d"); done
W="$(mktemp -d)"
"$LLVM/clang" -Werror -O2 -fno-builtin -std=c17 "${INC[@]}" -D__SOLANA__ -target sbf -fPIC -c onchain/entry.c -o "$W/entry.o"
"$LLVM/clang" -O2 -target sbf -fPIC -Wno-override-module -c "$LL" -o "$W/phil.o"
"$LLVM/ld.lld" -z notext -shared --Bdynamic "$SDK/c/sbf.ld" --entry entrypoint -o "$OUT" "$W/entry.o" "$W/phil.o"
ls -l "$OUT"
"$LLVM/llvm-objdump" -d --no-show-raw-insn "$OUT" 2>/dev/null | sed -n '1,40p' || true
